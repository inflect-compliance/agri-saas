/**
 * Redis Connection Helper — Shared Singleton
 *
 * Provides a single, reusable ioredis client for the entire application.
 * Used by jobs (BullMQ), caching, rate limiting, and async coordination.
 *
 * Design decisions:
 *   - Singleton cached on `globalThis` to survive HMR in Next.js dev mode
 *   - Lazy connect: client is created on first `getRedis()` call
 *   - Optional: returns `null` when REDIS_URL is not configured (graceful degradation)
 *   - BullMQ-compatible: BullMQ accepts ioredis instances directly
 *   - Safe disconnect for tests and graceful shutdown
 *
 * Usage:
 *   import { getRedis, getRedisOrThrow, isRedisAvailable } from '@/lib/redis';
 *
 *   // Optional — returns null if Redis not configured
 *   const redis = getRedis();
 *   if (redis) await redis.set('key', 'value');
 *
 *   // Required — throws if Redis not available
 *   const redis = getRedisOrThrow();
 *   await redis.set('key', 'value');
 *
 *   // BullMQ usage (future):
 *   const queue = new Queue('jobs', { connection: getRedisOrThrow() });
 *
 * @module lib/redis
 */
import Redis from 'ioredis';
import { logger } from '@/lib/observability/logger';

// ─── Global singleton (survives HMR in dev) ───

const globalForRedis = globalThis as unknown as {
    __redis_client?: Redis | null;
    __redis_url?: string;
};

/**
 * Returns the shared Redis client, or `null` if REDIS_URL is not configured.
 *
 * The client is created lazily on first call and cached globally.
 * Subsequent calls return the same instance.
 */
export function getRedis(): Redis | null {
    const url = process.env.REDIS_URL;
    if (!url) return null;

    // If URL changed (dev hot-reload), disconnect old client
    if (globalForRedis.__redis_client && globalForRedis.__redis_url !== url) {
        globalForRedis.__redis_client.disconnect();
        globalForRedis.__redis_client = undefined;
    }

    if (!globalForRedis.__redis_client) {
        const client = new Redis(url, {
            // ── Connection behavior ──
            maxRetriesPerRequest: null,     // Required for BullMQ compatibility
            enableReadyCheck: true,
            retryStrategy(times: number) {
                // Exponential backoff: 50ms, 100ms, 200ms... capped at 5s
                const delay = Math.min(times * 50, 5000);
                return delay;
            },
            // ── Timeouts ──
            connectTimeout: 10000,          // 10s to establish connection
            commandTimeout: 5000,           // 5s per command
            // ── Naming ──
            connectionName: 'inflect-app',
            lazyConnect: false,             // Connect immediately when created
        });

        client.on('connect', () => {
            logger.info('Redis connected', { component: 'redis', url: redactUrl(url) });
        });

        client.on('ready', () => {
            logger.info('Redis ready', { component: 'redis' });
        });

        client.on('error', (err) => {
            logger.error('Redis connection error', {
                component: 'redis',
                err: err instanceof Error ? err : new Error(String(err)),
            });
        });

        client.on('close', () => {
            logger.info('Redis connection closed', { component: 'redis' });
        });

        globalForRedis.__redis_client = client;
        globalForRedis.__redis_url = url;
    }

    return globalForRedis.__redis_client;
}

/**
 * Returns the shared Redis client.
 * Throws if REDIS_URL is not configured or client creation failed.
 */
export function getRedisOrThrow(): Redis {
    const client = getRedis();
    if (!client) {
        throw new Error(
            'Redis is not available. Set REDIS_URL environment variable. ' +
            'Run `docker compose up -d redis` to start the local Redis container.'
        );
    }
    return client;
}

/**
 * Quick readiness check — returns true if Redis is configured and connected.
 */
export async function isRedisAvailable(): Promise<boolean> {
    try {
        const client = getRedis();
        if (!client) return false;
        const result = await client.ping();
        return result === 'PONG';
    } catch {
        return false;
    }
}

/**
 * Redis `maxmemory-policy` values that EVICT keys under memory
 * pressure. BullMQ stores job state in Redis — any of these silently
 * drops queued jobs. The only BullMQ-safe policy is `noeviction`
 * (Redis rejects writes with an OOM error instead, which surfaces
 * loudly rather than losing data).
 */
const EVICTION_POLICIES: ReadonlySet<string> = new Set([
    'allkeys-lru',
    'allkeys-lfu',
    'allkeys-random',
    'volatile-lru',
    'volatile-lfu',
    'volatile-random',
    'volatile-ttl',
]);

/**
 * Best-effort startup check — verify the connected Redis is NOT
 * configured with a key-evicting `maxmemory-policy`.
 *
 * BullMQ requires `noeviction`: under memory pressure an eviction
 * policy drops job records, silently losing queued work. This runs
 * `CONFIG GET maxmemory-policy` once at startup:
 *
 *   - eviction policy detected → loud `logger.error` (production) or
 *     `logger.warn` (dev). Deliberately NOT a hard `process.exit`:
 *     a wrong policy is a degraded-not-broken state, and a boot-time
 *     crash loop on a drifted deployment is worse than a loud,
 *     alertable log. The structural guard
 *     `tests/guards/redis-eviction-policy.test.ts` is the fail-fast
 *     gate at PR time, before any unsafe compose file can land.
 *   - `CONFIG` unavailable (managed Redis such as ElastiCache often
 *     disables / renames it) → skipped quietly; the managed path's
 *     policy is enforced by terraform + `terraform-redis-storage.test.ts`.
 *
 * Returns the observed policy, or `null` when it could not be read.
 * Never throws.
 *
 * @param client — Redis client to probe; defaults to the shared
 *   singleton. An explicit client is the unit-test seam.
 */
export async function verifyRedisEvictionPolicy(
    client: Redis | null = getRedis(),
): Promise<string | null> {
    if (!client) return null;

    let policy: string | null = null;
    try {
        // `CONFIG GET maxmemory-policy` → ['maxmemory-policy', '<value>'].
        const res = await client.call('CONFIG', 'GET', 'maxmemory-policy');
        if (Array.isArray(res) && typeof res[1] === 'string') {
            policy = res[1];
        }
    } catch {
        // CONFIG unavailable (ElastiCache disables it) — cannot verify
        // here; terraform + its guard enforce the managed path.
        logger.info('Redis maxmemory-policy not verifiable (CONFIG GET unavailable)', {
            component: 'redis',
        });
        return null;
    }

    if (policy && EVICTION_POLICIES.has(policy)) {
        const msg =
            `Redis maxmemory-policy is '${policy}' — a key-EVICTING policy. ` +
            `BullMQ job state lives in Redis and can be silently dropped ` +
            `under memory pressure. Set 'noeviction'.`;
        if (process.env.NODE_ENV === 'production') {
            logger.error('UNSAFE Redis maxmemory-policy for BullMQ', {
                component: 'redis',
                err: new Error(msg),
                policy,
            });
        } else {
            logger.warn(msg, { component: 'redis', policy });
        }
    } else if (policy) {
        logger.info('Redis maxmemory-policy verified', {
            component: 'redis',
            policy,
        });
    }
    return policy;
}

/**
 * Disconnect the shared Redis client.
 * Used for clean shutdown in tests and graceful process exit.
 */
export async function disconnectRedis(): Promise<void> {
    if (globalForRedis.__redis_client) {
        await globalForRedis.__redis_client.quit();
        globalForRedis.__redis_client = undefined;
        globalForRedis.__redis_url = undefined;
    }
}

/**
 * Create a NEW Redis client (not the singleton).
 * Use this when you need an isolated connection (e.g. BullMQ workers
 * need separate pub/sub connections).
 *
 * Caller is responsible for disconnecting.
 */
export function createRedisClient(overrideUrl?: string): Redis {
    const url = overrideUrl || process.env.REDIS_URL;
    if (!url) {
        throw new Error('REDIS_URL is not configured');
    }
    return new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        connectTimeout: 10000,
        commandTimeout: 5000,
        connectionName: 'inflect-worker',
        lazyConnect: false,
    });
}

// ─── Internal helpers ───

/** Redact password from redis:// URL for logging */
function redactUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '***';
        }
        return parsed.toString();
    } catch {
        return 'redis://***';
    }
}
