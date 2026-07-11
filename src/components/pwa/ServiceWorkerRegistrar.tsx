'use client';

/**
 * Registers the operator-PWA service worker (`/public/sw.js`).
 *
 * Production-only: a SW intercepting fetches in dev fights Next.js HMR /
 * Fast Refresh, so registration is gated on `NODE_ENV === 'production'`.
 * Renders nothing. The SW itself is conservative (static-asset shell
 * cache only) — offline writes are handled by the client outbox, not the
 * SW.
 */
import { useCallback, useEffect, useState } from 'react';
import { InstallPrompt } from './InstallPrompt';
import { UpdateAvailableBanner } from './UpdateAvailableBanner';
import { isChunkLoadError } from '@/lib/pwa/chunk-error';

export function ServiceWorkerRegistrar() {
    // The new SW parked in "waiting" (a deploy landed while the app is open).
    // Surfaced as a non-blocking "Update ready — refresh" prompt; the update
    // only applies on the operator's consent (SKIP_WAITING) — never mid-session.
    const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') return;
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const register = () => {
            navigator.serviceWorker
                .register('/sw.js')
                .then((reg) => {
                    if (!reg) return;
                    // An update may already be parked (installed while closed).
                    if (reg.waiting && navigator.serviceWorker.controller) {
                        setWaitingWorker(reg.waiting);
                    }
                    // A new worker finished installing → offer the update once
                    // it reaches "installed" WITH an existing controller (i.e.
                    // it's an update, not the first install).
                    reg.addEventListener('updatefound', () => {
                        const nw = reg.installing;
                        if (!nw) return;
                        nw.addEventListener('statechange', () => {
                            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                                setWaitingWorker(nw);
                            }
                        });
                    });
                })
                .catch(() => {
                    /* registration is best-effort — the app works without it */
                });
        };
        if (document.readyState === 'complete') register();
        else window.addEventListener('load', register, { once: true });

        // The waiting worker took control (after SKIP_WAITING) → reload once so
        // the page runs the new assets. Guarded against a reload loop.
        let reloaded = false;
        const onControllerChange = () => {
            if (reloaded) return;
            reloaded = true;
            window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

        // Fallback flush trigger for browsers without Background Sync (iOS
        // Safari): on regained connectivity, nudge the SW to replay the
        // outbox. Browsers WITH Background Sync already replay via the
        // 'flush-outbox' sync tag, so this is harmless there.
        const nudgeFlush = () => {
            navigator.serviceWorker.ready
                .then((reg) => reg.active?.postMessage({ type: 'flush-outbox' }))
                .catch(() => {});
        };
        window.addEventListener('online', nudgeFlush);
        return () => {
            window.removeEventListener('online', nudgeFlush);
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        };
    }, []);

    // ChunkLoadError recovery. A lazy route/component chunk that fails to load
    // mid-navigation (flaky rural LTE, or a stale chunk hash after a deploy)
    // otherwise strands the operator on a half-rendered page — Sentry already
    // treats the error as benign, but nothing recovered from it. Reload once
    // to fetch the chunk fresh; a 10s timestamp guard prevents a reload loop
    // when the chunk is genuinely gone. Production-only (a reload would fight
    // Next HMR in dev; the E2E build runs production, so it's covered there).
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') return;
        const RELOAD_KEY = 'chunkReloadAt';
        const recover = (message: string, name?: string) => {
            if (!isChunkLoadError(message, name)) return;
            let last = 0;
            try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* private mode */ }
            const now = Date.now();
            if (now - last < 10_000) return; // reloaded recently → real failure, don't loop
            try { sessionStorage.setItem(RELOAD_KEY, String(now)); } catch { /* private mode */ }
            window.location.reload();
        };
        const onError = (e: ErrorEvent) => recover(e.message || '', (e.error as Error | undefined)?.name);
        const onRejection = (e: PromiseRejectionEvent) => {
            const r = e.reason as { message?: string; name?: string } | undefined;
            recover(r?.message || String(e.reason ?? ''), r?.name);
        };
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, []);

    // The install affordance attaches its own listeners (beforeinstallprompt
    // / appinstalled) and renders the mobile banner / iOS hint.
    // Consent → tell the waiting worker to take over. It skipWaiting()s,
    // activates + claims, and `controllerchange` (above) reloads the page.
    // Only ever fired on an explicit tap, so a deploy never interrupts an
    // in-flight outbox flush.
    const applyUpdate = useCallback(() => {
        waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    }, [waitingWorker]);

    return (
        <>
            <InstallPrompt />
            {waitingWorker && <UpdateAvailableBanner onApply={applyUpdate} />}
        </>
    );
}

export default ServiceWorkerRegistrar;
