/**
 * Roadmap-6 P3 — per-tenant persistent SWR cache provider.
 *
 * The PWA's SWR cache is memory-only by default: relaunch the app (or
 * let iOS/Android evict the tab) and the next cold start refetches the
 * WHOLE farm — every list, over rural LTE. This module gives SWR a
 * durable, self-evicting cache backing so a relaunch paints instantly
 * from disk and only revalidates (cheaply, thanks to the ETag/304 seam)
 * in the background.
 *
 * Design — two tiers, one Map:
 *
 *   • **localStorage (small / fast).** Hydrated SYNCHRONOUSLY at
 *     provider construction, so SWR renders from cache on the very
 *     first paint. This is the tier the rendered test exercises. Bodies
 *     serializing under `LS_BYTE_BUDGET` live here.
 *
 *   • **IndexedDB (large / durable).** Hydrated best-effort and
 *     ASYNCHRONOUSLY (IDB has no sync API); it backfills entries too
 *     large for localStorage. If IndexedDB is unavailable (private
 *     mode, old WebView, disabled) the whole tier silently no-ops and
 *     localStorage carries the load — never a crash.
 *
 * Isolation — the cache bucket is keyed PER TENANT (`namespace`), so a
 * shared device that signs into two tenants never lets one tenant's
 * cached rows surface under the other. The caller
 * (`SWRPersistenceProvider`) derives the namespace from the active
 * tenant slug and remounts `SWRConfig` when it changes, giving each
 * tenant its own freshly-hydrated Map.
 *
 * Self-eviction — every persisted bucket carries a schema `v` (bump
 * `SWR_CACHE_VERSION` to invalidate all buckets on a shape change) and
 * a write timestamp `t`. On hydrate, a bucket older than `maxAgeMs`
 * (default 24h) or from a stale version is dropped wholesale — stale
 * data never resurrects.
 */

/**
 * Bump on any change to the persisted entry shape (or to force-evict
 * every client's on-disk cache after a data-model change). A bucket
 * written under a different version is ignored on read.
 */
export const SWR_CACHE_VERSION = 1;

/** Default max age of a persisted bucket before it self-evicts. */
export const SWR_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const LS_PREFIX = 'agrent-swr';
/**
 * Serialized-payload ceiling for the localStorage tier (~1.5 MB, safely
 * under the ~5 MB per-origin localStorage cap once other keys are
 * accounted for). Above this the bucket goes to IndexedDB instead.
 */
const LS_BYTE_BUDGET = 1_500_000;

const IDB_NAME = 'agrent-swr-cache';
const IDB_STORE = 'buckets';

/** A single SWR key → its cached `data` (transient state is dropped). */
type SerializedEntry = [key: string, data: unknown];

interface PersistedBucket {
    v: number;
    t: number;
    entries: SerializedEntry[];
}

/**
 * Minimal SWR cache-state shape we read/write. SWR stores richer state
 * per key (`isValidating`, `isLoading`, …) but only `data` is worth
 * persisting; transient flags and non-serializable `error` objects are
 * intentionally dropped. Structurally assignable to SWR's own `State`
 * so a `Map<string, SwrState>` satisfies SWR's `Cache` contract.
 */
export interface SwrState {
    data?: unknown;
    error?: unknown;
}

type CacheMap = Map<string, SwrState>;

export interface PersistentCacheOptions {
    /** Per-tenant bucket key (usually the tenant slug). */
    namespace: string;
    /** Override the default 24h eviction window (tests). */
    maxAgeMs?: number;
    /** Injectable clock (tests). */
    now?: () => number;
    /**
     * Injectable localStorage-like store (tests). Defaults to the real
     * `window.localStorage` when available.
     */
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export function storageKey(namespace: string): string {
    return `${LS_PREFIX}:v${SWR_CACHE_VERSION}:${namespace}`;
}

function resolveLocalStorage(
    override: PersistentCacheOptions['storage'],
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (override !== undefined) return override;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch {
        // Access to localStorage can throw in sandboxed iframes / private
        // mode — treat as unavailable.
    }
    return null;
}

/** A valid, in-window bucket, or null if stale / malformed / wrong version. */
function parseBucket(
    raw: string | null,
    now: number,
    maxAgeMs: number,
): PersistedBucket | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as PersistedBucket;
        if (
            !parsed ||
            parsed.v !== SWR_CACHE_VERSION ||
            typeof parsed.t !== 'number' ||
            !Array.isArray(parsed.entries)
        ) {
            return null;
        }
        if (now - parsed.t > maxAgeMs) return null; // stale → self-evict
        return parsed;
    } catch {
        return null;
    }
}

function applyBucket(map: CacheMap, bucket: PersistedBucket): void {
    for (const [key, data] of bucket.entries) {
        if (typeof key !== 'string' || map.has(key)) continue;
        // Seed as an SWR state object; SWR reads `.data`.
        map.set(key, { data });
    }
}

/** Collect the persistable subset of the live cache: keys with data, no error. */
function collectEntries(map: CacheMap): SerializedEntry[] {
    const entries: SerializedEntry[] = [];
    for (const [key, value] of map.entries()) {
        if (typeof key !== 'string' || key.startsWith('$')) continue;
        const state = value as SwrState | undefined;
        if (!state || state.data === undefined || state.error !== undefined) {
            continue;
        }
        entries.push([key, state.data]);
    }
    return entries;
}

// ─── IndexedDB tier (best-effort, async, never throws) ───────────────

function idbAvailable(): boolean {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
        return false;
    }
}

function openIdb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function idbRead(key: string): Promise<string | null> {
    if (!idbAvailable()) return null;
    const db = await openIdb();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () =>
                resolve(typeof req.result === 'string' ? req.result : null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        } finally {
            // db closes with the transaction lifecycle; no explicit close
            // to avoid racing an in-flight request.
        }
    });
}

async function idbWrite(key: string, payload: string): Promise<void> {
    if (!idbAvailable()) return;
    const db = await openIdb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(payload, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch {
            resolve();
        }
    });
}

/**
 * Create a Map suitable for SWR's `provider` option, hydrated from the
 * per-tenant persistent cache and wired to flush back on tab-hide.
 *
 * Safe to call on the server (returns a plain empty Map — every browser
 * API is feature-detected).
 */
export function createPersistentCacheProvider(
    opts: PersistentCacheOptions,
): CacheMap {
    const map: CacheMap = new Map<string, SwrState>();
    const key = storageKey(opts.namespace);
    const now = opts.now ?? Date.now;
    const maxAgeMs = opts.maxAgeMs ?? SWR_CACHE_MAX_AGE_MS;
    const ls = resolveLocalStorage(opts.storage);

    // 1. Synchronous hydrate from localStorage — cache is live before the
    //    first render.
    try {
        const bucket = parseBucket(ls?.getItem(key) ?? null, now(), maxAgeMs);
        if (bucket) applyBucket(map, bucket);
        else if (ls) {
            // Drop a stale/mismatched bucket so it can't be re-read.
            try {
                ls.removeItem(key);
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* hydration is best-effort */
    }

    // 2. Async best-effort backfill from IndexedDB (large buckets). Only
    //    fills keys not already present from localStorage.
    void (async () => {
        try {
            const bucket = parseBucket(await idbRead(key), now(), maxAgeMs);
            if (bucket) applyBucket(map, bucket);
        } catch {
            /* ignore */
        }
    })();

    // 3. Flush on tab-hide (the last reliable moment before eviction).
    if (typeof window !== 'undefined') {
        const flush = () => {
            try {
                const entries = collectEntries(map);
                const payload = JSON.stringify({
                    v: SWR_CACHE_VERSION,
                    t: now(),
                    entries,
                } satisfies PersistedBucket);

                if (payload.length <= LS_BYTE_BUDGET) {
                    try {
                        ls?.setItem(key, payload);
                    } catch {
                        // Quota exceeded → spill the whole bucket to IDB.
                        void idbWrite(key, payload);
                    }
                } else {
                    // Too big for the small tier: clear it and use IDB.
                    try {
                        ls?.removeItem(key);
                    } catch {
                        /* ignore */
                    }
                    void idbWrite(key, payload);
                }
            } catch {
                /* flush is best-effort */
            }
        };

        window.addEventListener('pagehide', flush);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flush();
            });
        }
    }

    return map;
}
