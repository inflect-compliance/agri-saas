# 2026-07-10 — Redis-backed mutation rate limiter

**Commit:** `<sha> feat(rate-limit): distribute the mutation tier + progressive login lockout`

## Design

The mutation tier (Epic A.2) kept its sliding-window counters in a per-process
`Map`. On a multi-instance deployment that silently means the real budget is
`N × preset` — each instance only sees its own share of the traffic. This PR
moves the mutation tier (and the Epic A.3 progressive login lockout) onto the
same Upstash-Redis + in-memory-fallback pattern the auth/read tiers already
use, so a fleet enforces one global budget.

```
withApiErrorHandling / route ──> enforceRateLimit (async)
                                    └─> checkRateLimitDistributed  (mutationRateLimit.ts)
                                          ├─ Upstash configured → Ratelimit.slidingWindow(...).limit(key)   [1 round-trip]
                                          └─ no Upstash env      → checkRateLimit(key,cfg)  (in-process Map)

credentials login ──> evaluate/recordProgressive (async, rate-limit.ts)
                        ├─ Upstash configured → GET/SET timestamp blob (rl:prog:<key>)
                        └─ no Upstash env      → process Map (unchanged semantics)
```

All Node limiters now share one client factory
(`src/lib/rate-limit/upstashClient.ts`). Latency contract: exactly ONE Redis
round-trip on the mutation hot path (a single `Ratelimit.slidingWindow` op, no
pipeline).

## Files

| File | Role |
|------|------|
| `src/lib/rate-limit/upstashClient.ts` | NEW — shared Node Upstash client + backend-choice log-once |
| `src/lib/rate-limit/mutationRateLimit.ts` | NEW — distributed sliding window + memory fallback + reset |
| `src/lib/security/rate-limit-middleware.ts` | `enforceRateLimit` → async; CGNAT key-composition comment |
| `src/lib/security/rate-limit.ts` | progressive lockout → distributed-first (blob) + shared `computeProgressive` |
| `src/lib/auth/credentials.ts` | await the now-async progressive calls |
| `src/app/api/**/route.ts` (mfa ×2, invites ×5) | await `enforceRateLimit` / use distributed MFA check |
| `src/lib/offline/sync.ts` + `public/sw.js` | 429 offline-replay: retain queued work, no attempts bump, back off per `Retry-After` |
| `src/lib/offline/use-offline-sync.ts` | reschedule the drain on a 429 |
| `docs/rate-limiting.md` | "Horizontal scale checklist" — the shared-vs-per-process state inventory |

## Decisions

- **Gate on Upstash creds, not on `Redis.fromEnv()` throwing.** `fromEnv()`
  does NOT throw when the env is absent — it returns a *broken* client that
  fails slowly (HTTP retries, ~seconds) on first use. Since `RATE_LIMIT_MODE`
  defaults to `upstash`, a self-host that never set the Upstash env would
  otherwise pay that retry latency on every login/mutation before degrading.
  `getUpstashRedis()` returns the Map fallback unless
  `UPSTASH_REDIS_REST_URL` + `_TOKEN` are both present.
- **Lockout via sliding-window back-pressure.** `Ratelimit.slidingWindow`
  doesn't express a fixed `lockoutMs`; the presets that carry one are sized so
  `windowMs` bounds the block appropriately. Security property (blocked after
  `maxAttempts`) is identical.
- **Progressive lockout kept exact semantics** via a shared `computeProgressive`
  pure function used by both the Redis-blob and Map paths, so the two backends
  can't drift. Timing-safety preserved: evaluate issues one read on both the
  lockout and non-lockout branches, so no timing oracle; `dummyVerify` still
  equalises the verify cost.
- **429 offline replay is NOT the item's fault.** A reconnect burst legitimately
  outruns the limiter. The replay now retains queued work on 429 (never bumps
  attempts toward the drop threshold), stops the burst, and backs off per the
  server's `Retry-After` — a farmer's queued edits are never dropped.
- **Fail-to-memory, not fail-open.** A Redis error mid-request degrades to the
  local Map (still counting) rather than removing rate limiting entirely.
- **Audit-stream buffers stay per-process by design** (documented in the
  horizontal-scale checklist, not migrated).
