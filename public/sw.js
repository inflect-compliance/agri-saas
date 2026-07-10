/*
 * AgriSaaS service worker — operator PWA.
 *
 * Responsibilities:
 *   - Installable, fast app SHELL (static-asset + navigation caching).
 *   - OFFLINE-FIRST field data: the last-viewed location / parcels /
 *     field-operation GETs are network-first with a cache fallback, so the
 *     Map / my-Tasks / Field-execute routes open with no signal.
 *   - BACKGROUND SYNC: on a 'flush-outbox' sync event, replay the
 *     IndexedDB outbox (queued field mutations) so they deliver after the
 *     app is closed, when connectivity returns. Mirrors the client policy
 *     in src/lib/offline/sync.ts.
 *   - WEB PUSH: show task-assignment / spray-window notifications and focus
 *     the right route on click.
 *
 * Still conservative: non-GET requests are NEVER touched (writes are the
 * client outbox's job), and only the narrow field-data GETs are cached —
 * not arbitrary tenant data.
 *
 * Bump CACHE_VERSION to invalidate old caches on the next activate.
 */
const CACHE_VERSION = 'agri-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const DATA_CACHE = `${CACHE_VERSION}-fielddata`;
const PRECACHE = ['/icon.svg', '/manifest.webmanifest'];

// ── Outbox IndexedDB contract (shared with src/lib/offline/idb-outbox.ts) ──
const OUTBOX_DB = 'agri-offline';
const OUTBOX_DB_VERSION = 1;
const OUTBOX_STORE = 'outbox';
const OUTBOX_MAX_ATTEMPTS = 8; // mirrors MAX_ATTEMPTS in sync.ts
const FLUSH_OUTBOX_TAG = 'flush-outbox';

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
                    keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
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

// Narrow allowlist of field GET endpoints worth caching for offline open.
// Scoped on purpose — NOT a blanket /api cache (avoids stale/leaky tenant
// data). Covers: a location, its parcels, a field-operation, the operator's
// farm-task queue.
function isFieldDataRequest(url) {
    if (!url.pathname.startsWith('/api/')) return false;
    return (
        /\/locations\/[^/]+(?:\/parcels)?$/.test(url.pathname) ||
        /\/field-operations\/[^/]+$/.test(url.pathname) ||
        /\/farm-tasks(?:$|\?)/.test(url.pathname) ||
        url.pathname.endsWith('/farm-tasks')
    );
}

// Network-first with a cache fallback: fresh when online, last-viewed when
// offline. Only successful responses are cached.
async function networkFirstData(request) {
    const cache = await caches.open(DATA_CACHE);
    try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return; // writes never touched by the SW
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // third-party → passthrough

    if (url.pathname.startsWith('/api/')) {
        // Offline-first for the narrow field-data GETs; everything else
        // under /api stays network-only (the app + SWR own freshness).
        if (isFieldDataRequest(url)) event.respondWith(networkFirstData(request));
        return;
    }

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

    // Navigations: network-first with a cached-document fallback so a
    // previously-opened field route still opens offline.
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

// ── Background Sync: replay the IndexedDB outbox ───────────────────────
function openOutboxDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
                db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB.open failed'));
    });
}
function idbGetAll(db) {
    return new Promise((resolve, reject) => {
        const rq = db.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
    });
}
function idbWrite(db, op, arg) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, 'readwrite');
        const store = tx.objectStore(OUTBOX_STORE);
        op === 'put' ? store.put(arg) : store.delete(arg);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
function isTransient(status) {
    // status 0 = network throw. 408 + 5xx are retryable-with-attempt-bump.
    // 429 is handled separately (retain, no bump, stop the burst) — see below.
    return status === 0 || status === 408 || status >= 500;
}

// Replays every queued mutation once, applying the same policy as
// src/lib/offline/sync.ts (kept in lockstep). Rejects if work remains so the
// browser reschedules the sync (exponential backoff) until the queue drains.
//
// 429 is special: a reconnect burst can outrun the mutation rate limit. A 429
// is NOT the item's fault and WILL succeed later, so it must never bump the
// attempts counter (or a long burst would DROP a farmer's queued edits) and
// must stop the pass (no point replaying the rest into a closed window). We
// retain everything, surface the server's Retry-After to open clients, and
// throw so the browser reschedules the drain after backing off.
async function flushOutbox() {
    let db;
    try { db = await openOutboxDb(); } catch { return; }
    let items;
    try { items = await idbGetAll(db); } catch { return; }
    items.sort((a, b) => a.createdAt - b.createdAt);

    let transientRemains = false;
    let rateLimited = false;
    let retryAfterSeconds;
    for (const item of items) {
        let status = 0;
        let ok = false;
        let retryAfterHeader = null;
        try {
            const res = await fetch(item.url, {
                method: item.method,
                headers: { 'Content-Type': 'application/json' },
                body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
                credentials: 'same-origin',
            });
            status = res.status;
            ok = res.ok;
            if (status === 429) retryAfterHeader = res.headers.get('Retry-After');
        } catch {
            status = 0;
        }

        if (ok) {
            await idbWrite(db, 'delete', item.id);
        } else if (status === 429) {
            // Rate limited — retain untouched (no attempts bump, never
            // dropped) and stop draining into the closed window.
            rateLimited = true;
            const parsed = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
            if (Number.isFinite(parsed) && parsed >= 0) retryAfterSeconds = parsed;
            break;
        } else if (isTransient(status)) {
            const next = { ...item, attempts: (item.attempts || 0) + 1 };
            if (next.attempts >= OUTBOX_MAX_ATTEMPTS) await idbWrite(db, 'delete', item.id);
            else { await idbWrite(db, 'put', next); transientRemains = true; }
        } else {
            // Terminal client error — drop so the queue keeps moving.
            await idbWrite(db, 'delete', item.id);
        }
    }
    // Notify any open clients so their pending-count refreshes.
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'outbox-flushed', rateLimited, retryAfterSeconds }));
    if (rateLimited) throw new Error('outbox: rate limited — reschedule sync after backoff');
    if (transientRemains) throw new Error('outbox: transient failures remain — reschedule sync');
}

self.addEventListener('sync', (event) => {
    if (event.tag === FLUSH_OUTBOX_TAG) event.waitUntil(flushOutbox());
});

// Fallback trigger for browsers without Background Sync (iOS Safari): the
// page can postMessage a flush request (e.g. on regained connectivity).
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === FLUSH_OUTBOX_TAG) {
        event.waitUntil ? event.waitUntil(flushOutbox()) : flushOutbox();
    }
});

// ── Web Push ───────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { title: 'AgriSaaS', body: event.data ? event.data.text() : '' };
    }
    const title = payload.title || 'AgriSaaS';
    const options = {
        body: payload.body || payload.message || '',
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: payload.tag || undefined,
        data: { url: payload.url || payload.linkUrl || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
                if ('focus' in client) {
                    if ('navigate' in client) client.navigate(target);
                    return client.focus();
                }
            }
            return self.clients.openWindow(target);
        }),
    );
});
