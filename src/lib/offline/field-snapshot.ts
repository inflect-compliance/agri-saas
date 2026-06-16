'use client';

/**
 * Offline field-op snapshot — lets an operator's job page open with NO
 * signal (a cold offline reload), not just stay usable once loaded.
 *
 * The service worker serves the cached page *document* offline, but
 * `/api/*` is deliberately network-only (the SW never caches authenticated
 * tenant data), so SWR's field-op fetch fails offline and the panel would
 * otherwise render "not found". `OfflineFieldPanel` writes the last-loaded
 * field-op here (keyed by taskId) and reads it back as the render source
 * when the network fetch has nothing — and it persists every optimistic
 * mark, so a cold reload reflects work already queued in the outbox.
 *
 * `localStorage`, same store family + fail-soft posture as the outbox
 * (private mode / quota → no-op, never throws).
 */

const PREFIX = 'agri.offline.fieldop.v1.';

function keyFor(taskId: string): string {
    return `${PREFIX}${taskId}`;
}

/** Persist the field-op view for offline cold-load. Fail-soft. */
export function saveFieldSnapshot<T>(taskId: string, data: T): void {
    try {
        globalThis.localStorage?.setItem(keyFor(taskId), JSON.stringify(data));
    } catch {
        /* storage full / unavailable — drop silently */
    }
}

/** Read the last-saved field-op view, or null when none / unavailable. */
export function readFieldSnapshot<T>(taskId: string): T | null {
    try {
        const raw = globalThis.localStorage?.getItem(keyFor(taskId));
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

/** Drop a snapshot (e.g. once the job is fully synced + closed). Fail-soft. */
export function clearFieldSnapshot(taskId: string): void {
    try {
        globalThis.localStorage?.removeItem(keyFor(taskId));
    } catch {
        /* no-op */
    }
}
