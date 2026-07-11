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

export interface OfflineSync {
    online: boolean;
    /** Total queued items (mutations + photos). */
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
}

export function useOfflineSync(): OfflineSync {
    const [pending, setPending] = useState(0);
    const [pendingPhotos, setPendingPhotos] = useState(0);
    const [online, setOnline] = useState(true);
    // Guards against two flushes running at once (the `online` event +
    // a manual "Sync now" / mount flush) — concurrent drains would read
    // the same items and double-send them.
    const flushing = useRef(false);
    // Honors a 429 Retry-After: schedule the next drain instead of hammering.
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushRef = useRef<(() => Promise<FlushSummary>) | null>(null);

    const refresh = useCallback(async () => {
        const items = await getOutboxStore().all();
        setPending(items.length);
        setPendingPhotos(items.filter(isPhotoItem).length);
    }, []);

    const flush = useCallback(async (): Promise<FlushSummary> => {
        if (flushing.current) {
            const remaining = (await getOutboxStore().all()).length;
            return { sent: 0, failed: 0, dropped: 0, remaining, rateLimited: false };
        }
        flushing.current = true;
        try {
            const res = await flushOutbox(getOutboxStore(), fetchSender());
            setPending(res.remaining);
            // Recompute the photo-only sub-count (mutations + photos may both
            // have drained) so the sync bar's "N photos queued" stays honest.
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
            if (!offline) {
                try {
                    const res = await fetch(input.url, {
                        method: input.method,
                        headers: { 'Content-Type': 'application/json' },
                        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
                    });
                    if (res.ok) return 'sent';
                    if (isTerminalClientError(res.status)) {
                        throw new Error(`Request failed (${res.status})`);
                    }
                    // transient (5xx/408/429) → fall through to queue
                } catch (err) {
                    // A thrown terminal error propagates; a network throw queues.
                    if (err instanceof Error && err.message.startsWith('Request failed (4')) throw err;
                }
            }
            await enqueue(getOutboxStore(), input);
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

    return { online, pending, pendingPhotos, submit, submitPhoto, flush };
}
