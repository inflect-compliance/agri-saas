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
import { getOutboxStore, enqueue, type EnqueueInput } from './outbox';
import { flushOutbox, fetchSender, type FlushSummary } from './sync';

function isTerminalClientError(status: number): boolean {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export interface OfflineSync {
    online: boolean;
    pending: number;
    submit: (input: EnqueueInput) => Promise<'sent' | 'queued'>;
    flush: () => Promise<FlushSummary>;
}

export function useOfflineSync(): OfflineSync {
    const [pending, setPending] = useState(0);
    const [online, setOnline] = useState(true);
    // Guards against two flushes running at once (the `online` event +
    // a manual "Sync now" / mount flush) — concurrent drains would read
    // the same items and double-send them.
    const flushing = useRef(false);

    const refresh = useCallback(async () => {
        setPending((await getOutboxStore().all()).length);
    }, []);

    const flush = useCallback(async (): Promise<FlushSummary> => {
        if (flushing.current) {
            const remaining = (await getOutboxStore().all()).length;
            return { sent: 0, failed: 0, dropped: 0, remaining };
        }
        flushing.current = true;
        try {
            const res = await flushOutbox(getOutboxStore(), fetchSender());
            setPending(res.remaining);
            return res;
        } finally {
            flushing.current = false;
        }
    }, []);

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
            return 'queued';
        },
        [refresh],
    );

    return { online, pending, submit, flush };
}
