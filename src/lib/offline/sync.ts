/**
 * Offline sync — the "replay" half of queue-and-sync.
 *
 * `flushOutbox` drains the outbox in FIFO order, handing each item to a
 * `Sender` (the real one POSTs/PATCHes via fetch). The retry policy is
 * the crux:
 *   - 2xx success            → remove (delivered).
 *   - 4xx (except 408/429)   → DROP. A client error won't succeed on
 *                              retry; keeping it would wedge the queue
 *                              behind a permanently-failing item.
 *   - network throw / 5xx /
 *     408 / 429              → KEEP + bump attempts (transient; retry on
 *                              the next flush / reconnect).
 *
 * Items past `MAX_ATTEMPTS` are dropped so a poison item can't block the
 * queue forever. The same item id rides every retry, so a server that
 * dedupes on it sees at-least-once delivery as exactly-once.
 */
import type { OutboxItem, OutboxStore } from './outbox';

export interface SendResult {
    ok: boolean;
    status: number;
}

export type Sender = (item: OutboxItem) => Promise<SendResult>;

export interface FlushSummary {
    sent: number;
    failed: number;
    dropped: number;
    remaining: number;
}

export const MAX_ATTEMPTS = 8;

function isTransient(status: number): boolean {
    // Network throw is signalled as status 0. 408 (timeout) + 429 (rate
    // limit) are retryable; every other 4xx is terminal.
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Drain the outbox once. Safe to call repeatedly (idempotent per item). */
export async function flushOutbox(store: OutboxStore, send: Sender): Promise<FlushSummary> {
    const items = await store.all(); // FIFO (createdAt asc)
    let sent = 0;
    let failed = 0;
    let dropped = 0;

    for (const item of items) {
        let res: SendResult;
        try {
            res = await send(item);
        } catch {
            res = { ok: false, status: 0 }; // network unreachable
        }

        if (res.ok) {
            await store.remove(item.id);
            sent++;
        } else if (isTransient(res.status)) {
            const next = { ...item, attempts: item.attempts + 1 };
            if (next.attempts >= MAX_ATTEMPTS) {
                await store.remove(item.id);
                dropped++;
            } else {
                await store.update(next);
                failed++;
            }
        } else {
            // Terminal client error — drop so the queue keeps moving.
            await store.remove(item.id);
            dropped++;
        }
    }

    const remaining = (await store.all()).length;
    return { sent, failed, dropped, remaining };
}

/** A fetch-backed Sender for the browser. */
export function fetchSender(): Sender {
    return async (item) => {
        const res = await fetch(item.url, {
            method: item.method,
            headers: { 'Content-Type': 'application/json' },
            body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
        });
        return { ok: res.ok, status: res.status };
    };
}
