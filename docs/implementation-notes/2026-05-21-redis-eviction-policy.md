# 2026-05-21 — Redis eviction policy: BullMQ durability

**Commit:** `<pending> fix(redis): noeviction maxmemory-policy for BullMQ-bearing Redis`

## Design

Every Docker Compose `redis` service ran
`redis-server … --maxmemory <N> --maxmemory-policy allkeys-lru`.
`allkeys-lru` **evicts** keys under memory pressure. BullMQ stores
job records in Redis — under an eviction policy those records are
silently dropped, losing queued work with no error.

The ElastiCache path was already correct: the terraform parameter
group pins `maxmemory-policy = noeviction` (guarded by
`terraform-redis-storage.test.ts`). The **Compose** path was not —
an operator running the production-like Compose stack on bare metal
silently ran an unsafe queue.

The remediation:

1. **All four Compose `redis` services** → `--maxmemory-policy
   noeviction` (`docker-compose.yml` dev + the three production-like
   files). With `noeviction` + a `maxmemory` cap, a full Redis
   rejects writes with `OOM` — workers fail to enqueue and the
   failure is *visible* — instead of discarding job state.
   `docker-compose.test.yml` sets no `maxmemory` at all and inherits
   Redis's own default (`noeviction`); left untouched.

2. **Runtime check** — `verifyRedisEvictionPolicy` in
   `src/lib/redis.ts`, called at startup from
   `src/instrumentation.ts`. Runs `CONFIG GET maxmemory-policy`:
   an evicting policy logs loudly (`logger.error` in production,
   `logger.warn` in dev); `CONFIG` unavailable (ElastiCache disables
   it) → skipped quietly. It is **best-effort and non-blocking** —
   see the decision below.

3. **Structural guard** — `tests/guards/redis-eviction-policy.test.ts`
   fails CI if any Compose `redis` service reverts to an evicting
   policy, and asserts the runtime check stays wired.

## Files

| File | Role |
|------|------|
| `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`, `deploy/docker-compose.prod.yml` | `--maxmemory-policy allkeys-lru` → `noeviction` + an explanatory comment. |
| `src/lib/redis.ts` | New `verifyRedisEvictionPolicy` (best-effort `CONFIG GET` check). |
| `src/instrumentation.ts` | Calls `verifyRedisEvictionPolicy` at startup (non-blocking). |
| `tests/guards/redis-eviction-policy.test.ts` | NEW — structural ratchet on the Compose policy + runtime-check wiring. |
| `tests/unit/redis-eviction-policy.test.ts` | NEW — unit tests for the detector. |
| `docs/deployment.md` | New "Redis — eviction policy" per-environment section. |

## Decisions

- **The runtime check does NOT `process.exit`.** A wrong eviction
  policy is degraded-not-broken (BullMQ works; jobs are only lost
  *under memory pressure*), unlike a missing encryption key or
  `REDIS_URL`. A boot-time `process.exit(1)` on a deployment whose
  hand-managed compose has drifted would crash-loop the site — the
  exact failure mode a recent Redis-auth drift already caused. So
  the runtime check logs loudly (alertable) and the **structural
  guard is the fail-fast gate** — it stops an unsafe compose file
  from ever being committed, which is the earliest and safest point.

- **`CONFIG GET` failure is non-fatal.** Managed Redis (ElastiCache)
  commonly disables or renames `CONFIG`. The check treats an
  unreadable policy as "cannot verify here" and returns quietly —
  the managed path's policy is enforced by terraform and its own
  guard, so there is nothing to re-prove at app startup.

- **Dev Compose fixed too, not just production-like.** `noeviction`
  is a BullMQ *correctness* requirement wherever the queue runs —
  not a production-only concern. `allkeys-lru` in dev causes
  confusing "my job vanished" bugs under the 128 MB cap; there is no
  developer-ergonomics reason to keep it.

- **`maxmemory` caps kept.** Only the *policy* changed. The cap is a
  safety ceiling; with `noeviction` it converts a memory-pressure
  event from silent data loss into a visible `OOM` write rejection.
