/*
 * AgriSaaS service worker — operator PWA (queue-and-sync).
 *
 * Deliberately conservative. Its job is installability + a fast/offline
 * app SHELL, never to cache dynamic or authenticated content:
 *
 *   - Non-GET (POST/PATCH/DELETE)  → passthrough. Offline writes are the
 *     client outbox's job (src/lib/offline), not the SW's — the SW must
 *     never silently swallow or replay a mutation.
 *   - /api/*                       → network-only (no caching of tenant
 *     data; the app + SWR handle data freshness).
 *   - same-origin static assets    → stale-while-revalidate.
 *   - navigations                  → network-first, fall back to the
 *     last-seen cached document, then a minimal offline notice.
 *
 * Bump CACHE_VERSION to invalidate old caches on the next activate.
 */
const CACHE_VERSION = 'agri-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const PRECACHE = ['/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => !k.startsWith(CACHE_VERSION))
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

function isStaticAsset(url) {
    return (
        url.pathname.startsWith('/_next/static/') ||
        /\.(?:css|js|woff2?|ttf|svg|png|jpg|jpeg|gif|webp|ico)$/.test(url.pathname)
    );
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return; // writes never touched by the SW
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // third-party → passthrough
    if (url.pathname.startsWith('/api/')) return; // never cache API/tenant data

    // Static assets: stale-while-revalidate.
    if (isStaticAsset(url)) {
        event.respondWith(
            caches.open(STATIC_CACHE).then(async (cache) => {
                const cached = await cache.match(request);
                const network = fetch(request)
                    .then((res) => {
                        if (res.ok) cache.put(request, res.clone());
                        return res;
                    })
                    .catch(() => cached);
                return cached || network;
            }),
        );
        return;
    }

    // Navigations: network-first with a cached-document fallback.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    return (
                        cached ||
                        new Response(
                            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;background:#0b1220;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#86efac">Offline</h1><p>You’re offline. Marked jobs are queued and will sync when you reconnect.</p></div></body>',
                            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
                        )
                    );
                }),
        );
    }
});
