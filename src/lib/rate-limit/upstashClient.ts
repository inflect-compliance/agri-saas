/**
 * Shared Upstash-Redis client for the NODE-runtime rate limiters.
 *
 * The Edge limiters (`authRateLimit.ts`, `apiReadRateLimit.ts`) each call
 * `Redis.fromEnv()` inline because they run on the Edge runtime with
 * `edgeLogger`. The Node-tier limiters (mutation tier, credential backoff,
 * progressive login policy) share THIS one factory instead of hand-rolling a
 * second client each — one place decides "Upstash or in-process fallback",
 * one place logs the choice.
 *
 * Backend selection (mirrors the Edge modules exactly):
 *   • `RATE_LIMIT_MODE=memory`            → in-process Map fallback, no client.
 *   • `RATE_LIMIT_MODE=upstash` (default) → `Redis.fromEnv()`. If the
 *     `UPSTASH_REDIS_REST_*` env is absent, `fromEnv()` throws, we catch, and
 *     the caller degrades to the in-process Map. So a zero-config self-hosted
 *     single node — mode left at its `upstash` default but no Upstash env —
 *     stays on the Map with no extra configuration. That is the intended
 *     self-host contract (docs/rate-limiting.md "horizontal scale checklist").
 *
 * The chosen backend is logged ONCE at info level so an operator can confirm
 * from the boot logs whether counters are shared across instances or local.
 */
import { Redis } from '@upstash/redis';

import { env } from '@/env';
import { logger } from '@/lib/observability/logger';

let _redis: Redis | null = null;
let _resolved = false;
let _logged = false;

function logBackendOnce(backend: 'upstash' | 'memory', detail: string): void {
    if (_logged) return;
    _logged = true;
    logger.info('rate-limit.backend', {
        component: 'rate-limit',
        backend,
        detail,
    });
}

/**
 * Return the shared Upstash client, or `null` when the process should use the
 * in-process Map fallback. Memoised: the backend decision + its info log fire
 * exactly once per process.
 */
export function getUpstashRedis(): Redis | null {
    if (_resolved) return _redis;
    _resolved = true;

    if (env.RATE_LIMIT_MODE !== 'upstash') {
        logBackendOnce('memory', 'RATE_LIMIT_MODE=memory — counters are per-instance');
        return null;
    }

    // CRITICAL: `Redis.fromEnv()` does NOT throw when the creds are missing —
    // it returns a *broken* client that only fails on first use, and fails
    // SLOWLY (HTTP retries with backoff, ~seconds per call) before surfacing
    // the error. `RATE_LIMIT_MODE` defaults to `upstash`, so a self-host that
    // simply never set the Upstash env would otherwise pay that retry latency
    // on every login/mutation before degrading. Gate on the creds actually
    // being present, so "no Upstash env" ⇒ the in-process Map immediately.
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
        logBackendOnce('memory', 'no Upstash env — in-process Map fallback (single-instance only)');
        return null;
    }

    try {
        _redis = Redis.fromEnv();
        logBackendOnce('upstash', 'Upstash Redis — counters shared across instances');
    } catch {
        _redis = null;
        logBackendOnce('memory', 'Upstash init failed — in-process Map fallback');
    }
    return _redis;
}

/** Test-only: forget the memoised client so a suite can flip env between files. */
export function __resetUpstashClientForTests(): void {
    _redis = null;
    _resolved = false;
    _logged = false;
}
