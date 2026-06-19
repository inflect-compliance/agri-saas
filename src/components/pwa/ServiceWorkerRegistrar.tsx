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

    // The install affordance attaches its own listeners (beforeinstallprompt
    // / appinstalled) and renders the mobile banner / iOS hint.
    return <InstallPrompt />;
}

export default ServiceWorkerRegistrar;
