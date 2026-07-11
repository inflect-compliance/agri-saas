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
import { useEffect } from 'react';
import { InstallPrompt } from './InstallPrompt';
import { isChunkLoadError } from '@/lib/pwa/chunk-error';

export function ServiceWorkerRegistrar() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') return;
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const register = () => {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                /* registration is best-effort — the app works without it */
            });
        };
        if (document.readyState === 'complete') register();
        else window.addEventListener('load', register, { once: true });

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
        return () => window.removeEventListener('online', nudgeFlush);
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
    return <InstallPrompt />;
}

export default ServiceWorkerRegistrar;
