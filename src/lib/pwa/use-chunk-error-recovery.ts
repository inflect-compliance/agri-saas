'use client';

/**
 * Error-boundary recovery from a stale-chunk load failure.
 *
 * A lazy route/component chunk that 404s after a deploy — the client is still
 * on an OLD service-worker bundle and asks for a chunk hash that no longer
 * exists — throws a `ChunkLoadError`. `ServiceWorkerRegistrar` already recovers
 * the ones that surface via `window.onerror` / `unhandledrejection`, but a chunk
 * error thrown during a route's RENDER is caught by the React error boundary
 * first and never reaches those listeners — so the operator is stranded on
 * "Something went wrong" instead of just reloading onto the fresh assets.
 *
 * This hook closes that path: when an error boundary catches a chunk error, it
 * reloads ONCE, sharing the same 10s `chunkReloadAt` sessionStorage guard as
 * `ServiceWorkerRegistrar` so the two never loop (a chunk that is still missing
 * 10s later is a genuine failure — fall through to the error UI). Production
 * only (a reload would fight Next HMR in dev; the E2E build runs production).
 *
 * @returns `true` while a recovery reload is imminent — the boundary should
 *          render nothing rather than flash the error UI.
 */
import { useEffect, useState } from 'react';
import { isChunkLoadError } from './chunk-error';

/** Shared with ServiceWorkerRegistrar's ChunkLoadError guard — one reload window. */
const RELOAD_KEY = 'chunkReloadAt';

function shouldRecover(error: { message?: string; name?: string }): boolean {
    if (!isChunkLoadError(error.message ?? '', error.name)) return false;
    if (process.env.NODE_ENV !== 'production') return false;
    if (typeof window === 'undefined') return false;
    let last = 0;
    try {
        last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    } catch {
        /* private mode — treat as never reloaded */
    }
    // Reloaded within the last 10s ⇒ the chunk is genuinely gone; don't loop.
    return Date.now() - last >= 10_000;
}

export function useChunkErrorRecovery(error: { message?: string; name?: string }): boolean {
    // Decide once, at catch time — the guard must not re-evaluate across renders.
    const [recovering] = useState(() => shouldRecover(error));

    useEffect(() => {
        if (!recovering) return;
        try {
            sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        } catch {
            /* private mode — the reload below still runs */
        }
        window.location.reload();
    }, [recovering]);

    return recovering;
}
