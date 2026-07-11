'use client';

/**
 * useOfflineSync — the operator PWA's offline mutation primitive.
 *
 * `submit` tries the network first when online; on a network failure or
 * when offline it appends the mutation to the outbox and returns
 * 'queued'. The hook tracks `online` + the `pending` count and flushes
 * the outbox automatically on the `online` event (reconnect) and on
 * mount. A terminal 4xx is thrown so the caller can surface it — the
 * operation will never succeed, so queueing it would be a lie.
 */
import { useCallback, useEffect, useState, useRef } from 'react';
import {
    getOutboxStore,
    enqueue,
    enqueuePhoto,
    isPhotoItem,
    type EnqueueInput,
    type EnqueuePhotoInput,
    type OutboxItem,
} from './outbox';
import { indexedDbAvailable } from './idb-outbox';
import { flushOutbox, fetchSender, type FlushSummary } from './sync';
import { haptic } from '@/lib/haptics';

function isTerminalClientError(status: number): boolean {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Shared with public/sw.js — the Background Sync tag that triggers a replay. */
export const FLUSH_OUTBOX_SYNC_TAG = 'flush-outbox';

/**
 * Ask the service worker to flush the outbox when connectivity returns —
 * even if the app has been closed. Progressive enhancement:
 *   - Background Sync API present (Android/Chrome) → register the
 *     'flush-outbox' tag; the SW's `sync` handler replays from IndexedDB.
 *   - Not present (iOS Safari, Firefox) → no-op here; the page-side
 *     `online`-event flush already covers reconnect-while-open.
 * Always best-effort — a failure here is swallowed so queueing never breaks.
 */
async function registerOutboxSync(): Promise<void> {
    try {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
        if (sync) await sync.register(FLUSH_OUTBOX_SYNC_TAG);
    } catch {
        /* Background Sync unavailable / denied — fall back to online-event flush. */
    }
}

export type ConflictResolution = 'keep-mine' | 'take-server';

export interface OfflineSync {
    online: boolean;
    /** Queued items (mutations + photos) still waiting to send — excludes parked conflicts. */
    pending: number;
    /** Queued PHOTO uploads only — surfaced distinctly in the sync bar. */
    pendingPhotos: number;
    submit: (input: EnqueueInput) => Promise<'sent' | 'queued'>;
    /**
     * Queue (or send-then-queue) a photo upload. The blob is the ALREADY
     * downscaled bytes; oversized blobs reject at enqueue. Requires
     * IndexedDB (the only store that can hold a Blob) — throws otherwise so
     * the caller can fall back to a direct online-only upload.
     */
    submitPhoto: (input: EnqueuePhotoInput) => Promise<'sent' | 'queued'>;
    flush: () => Promise<FlushSummary>;
    /** Writes parked as 409 conflicts, awaiting keep-mine / take-server. */
    conflicts: OutboxItem[];
    /**
     * Resolve a parked conflict: `take-server` discards the queued edit;
     * `keep-mine` re-sends it at the server's current version so it wins.
     */
    resolveConflict: (id: string, resolution: ConflictResolution) => Promise<void>;
}

export function useOfflineSync(): OfflineSync {
    const [pending, setPending] = useState(0);
    const [pendingPhotos, setPendingPhotos] = useState(0);
    const [conflicts, setConflicts] = useState<OutboxItem[]>([]);
    const [online, setOnline] = useState(true);
    // Guards against two flushes running at once (the `online` event +
    // a manual "Sync now" / mount flush) — concurrent drains would read
    // the same items and double-send them.
    const flushing = useRef(false);
    // Honors a 429 Retry-After: schedule the next drain instead of hammering.
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushRef = useRef<(() => Promise<FlushSummary>) | null>(null);

    const refresh = useCallback(async () => {
        const all = await getOutboxStore().all();
        // Parked conflicts aren't "pending to send" — they need the operator.
        const live = all.filter((i) => !i.conflict);
        setPending(live.length);
        setPendingPhotos(live.filter(isPhotoItem).length);
        setConflicts(all.filter((i) => i.conflict));
    }, []);

    const flush = useCallback(async (): Promise<FlushSummary> => {
        if (flushing.current) {
            const remaining = (await getOutboxStore().all()).length;
            return { sent: 0, failed: 0, dropped: 0, conflicts: 0, remaining, rateLimited: false };
        }
        flushing.current = true;
        try {
            const res = await flushOutbox(getOutboxStore(), fetchSender());
            // Refresh pending + the photo sub-count + conflicts — a flush can
            // drain photos/mutations AND park a 409 the resolution UI must show.
            await refresh();
            // Rate-limited mid-burst with work still queued → back off for the
            // server's Retry-After (default one mutation window) and re-drain,
            // rather than waiting for the next reconnect that may never come.
            if (res.rateLimited && res.remaining > 0) {
                const backoffMs = Math.max(1, res.retryAfterSeconds ?? 60) * 1000;
                if (retryTimer.current) clearTimeout(retryTimer.current);
                retryTimer.current = setTimeout(() => {
                    void flushRef.current?.();
                }, backoffMs);
            }
            return res;
        } finally {
            flushing.current = false;
        }
    }, [refresh]);
    flushRef.current = flush;

    useEffect(() => {
        // Hydration-safe: `online` initialises to true (matching SSR) and
        // is synced to the real navigator.onLine here, post-mount — a lazy
        // useState initializer would read navigator on the client's first
        // render and mismatch the server's markup when offline.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync (see above)
        setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
        void refresh();
        const onOnline = () => {
            setOnline(true);
            void flush();
        };
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            if (retryTimer.current) clearTimeout(retryTimer.current);
        };
    }, [flush, refresh]);

    const submit = useCallback(
        async (input: EnqueueInput): Promise<'sent' | 'queued'> => {
            const offline = typeof navigator !== 'undefined' && !navigator.onLine;
            const store = getOutboxStore();
            if (!offline) {
                try {
                    const res = await fetch(input.url, {
                        method: input.method,
                        headers: {
                            'Content-Type': 'application/json',
                            ...(input.ifMatch !== undefined ? { 'If-Match': String(input.ifMatch) } : {}),
                        },
                        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
                    });
                    if (res.ok) return 'sent';
                    if (res.status === 409) {
                        // Optimistic-lock conflict even while online (a concurrent
                        // edit landed first). Park it for the resolution UI rather
                        // than throwing — keep-mine / take-server, same as a replay.
                        const server = await res.json().catch(() => undefined);
                        const item = await enqueue(store, input);
                        await store.update({ ...item, conflict: { status: 409, server } });
                        await refresh();
                        return 'queued';
                    }
                    if (isTerminalClientError(res.status)) {
                        throw new Error(`Request failed (${res.status})`);
                    }
                    // transient (5xx/408/429) → fall through to queue
                } catch (err) {
                    // A thrown terminal error propagates; a network throw queues.
                    if (err instanceof Error && err.message.startsWith('Request failed (4')) throw err;
                }
            }
            await enqueue(store, input);
            await refresh();
            // Tactile confirmation that the action was saved offline (gloves +
            // no signal) — capability-gated, no-op on desktop/reduced-motion.
            haptic('tap');
            // First failure → ask the SW to replay when the network returns,
            // even if the operator closes the app (Background Sync).
            void registerOutboxSync();
            return 'queued';
        },
        [refresh],
    );

    const submitPhoto = useCallback(
        async (input: EnqueuePhotoInput): Promise<'sent' | 'queued'> => {
            // A Blob can only be queued in IndexedDB — the localStorage/
            // in-memory fallbacks would JSON-serialise it to `{}`. If IDB is
            // unavailable, throw so the caller can attempt a direct upload
            // instead of silently dropping the photo.
            if (!indexedDbAvailable()) {
                throw new Error('offline photo queue unavailable (no IndexedDB)');
            }
            const offline = typeof navigator !== 'undefined' && !navigator.onLine;
            if (!offline) {
                try {
                    const fd = new FormData();
                    fd.append('file', new File([input.blob], input.fileName, { type: input.fileType }));
                    const res = await fetch(input.url, { method: 'POST', body: fd });
                    if (res.ok) return 'sent';
                    if (isTerminalClientError(res.status)) {
                        throw new Error(`Request failed (${res.status})`);
                    }
                    // transient (5xx/408/429) → fall through to queue
                } catch (err) {
                    if (err instanceof Error && err.message.startsWith('Request failed (4')) throw err;
                }
            }
            // Enforces MAX_QUEUED_PHOTO_BYTES — an oversized blob throws here.
            await enqueuePhoto(getOutboxStore(), input);
            await refresh();
            haptic('tap');
            void registerOutboxSync();
            return 'queued';
        },
        [refresh],
    );

    const resolveConflict = useCallback(
        async (id: string, resolution: ConflictResolution) => {
            const store = getOutboxStore();
            const item = (await store.all()).find((i) => i.id === id);
            if (!item) {
                await refresh();
                return;
            }
            if (resolution === 'take-server') {
                // Discard the queued edit — the server's version wins.
                await store.remove(id);
            } else {
                // keep-mine — re-send at the server's CURRENT version so the
                // write is accepted (version matches) and the operator's edit
                // overwrites, deliberately this time.
                const server = item.conflict?.server as { currentVersion?: number } | undefined;
                const retry: OutboxItem = {
                    ...item,
                    ifMatch: typeof server?.currentVersion === 'number' ? server.currentVersion : undefined,
                    conflict: undefined,
                };
                const res = await fetchSender()(retry);
                if (res.ok) {
                    await store.remove(id);
                } else {
                    // Still conflicting (raced again) — re-park with fresh state.
                    await store.update({ ...retry, conflict: { status: res.status, server: res.conflict ?? server } });
                }
            }
            await refresh();
        },
        [refresh],
    );

    return { online, pending, pendingPhotos, submit, submitPhoto, flush, conflicts, resolveConflict };
}
