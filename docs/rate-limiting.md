# API Rate Limiting

Inflect Compliance has **three distinct rate-limit tiers**, each scoped
to a different traffic class. None of them share a budget — a runaway
script that exhausts the read tier can still log in, and a credential
spray attack does not consume the read budget for legitimate users.

## Tiers

| Tier | Preset | Budget | Applied at | Key shape |
|------|--------|--------|------------|-----------|
| **Auth** | tiered (10/30/60 per min) | 10/min for sign-in callbacks; 30/min for session probes; 60/min for `/csrf` and `/providers` | Edge middleware | `(IP, ua-hash)` |
| **Mutation** | `API_MUTATION_LIMIT` | 60 per minute | Node route handlers via `withApiErrorHandling` | `(IP, userId)` |
| **Read** | `API_READ_LIMIT` | 120 per minute | Edge middleware | `(IP, userId, tenantSlug)` |

All numbers are sized for normal interactive use — a real user filling
forms or paginating lists is well below every threshold. Scripts and
tests that need higher throughput should use a dedicated API key with
its own rate plan (future work) rather than share the interactive
budget.

## Where each tier lives

| Tier | Source of truth (preset) | Enforcement module | Storage |
|------|--------------------------|--------------------|---------|
| Auth | `src/lib/rate-limit/authRateLimit.ts` | same file | Upstash + memory fallback |
| Mutation | `src/lib/security/rate-limit.ts` (`API_MUTATION_LIMIT`, `EXCHANGE_*`, …) | `src/lib/security/rate-limit-middleware.ts::withRateLimit` → `src/lib/rate-limit/mutationRateLimit.ts` | **Upstash + memory fallback** (Roadmap-5 PR1) |
| Read | `src/lib/security/rate-limit.ts` (`API_READ_LIMIT`) | `src/lib/rate-limit/apiReadRateLimit.ts` | Upstash + memory fallback |

Roadmap-5 PR1 moved the **mutation** tier off its in-process `Map` onto the
same Upstash-Redis + in-memory-fallback pattern the auth/read tiers already
use, so a multi-instance fleet enforces one global budget instead of
`N × preset`. The counter goes through `mutationRateLimit.ts`, which uses a
single `Ratelimit.slidingWindow` op (one Redis round-trip on the hot path) and
falls back to the in-process Map when no Upstash env is configured. All Node
limiters share one client factory (`src/lib/rate-limit/upstashClient.ts`).

The **read** tier was added as part of GAP-17 closure. Pre-GAP-17 the
codebase had only auth + mutation tiers; tenant-scoped GETs were
unprotected. The new tier mirrors `authRateLimit.ts`'s edge-runtime
shape so it works inside the Next.js middleware (which runs on the
Edge runtime and can't import the Node-only `withApiErrorHandling`
wrapper).

## Read-tier scope

The read tier matches **only**:

- **GET method** — mutations have their own tier. POST/PUT/PATCH/DELETE
  on the same path go through `API_MUTATION_LIMIT` instead.
- **Path starts with `/api/t/`** — i.e. tenant-scoped API routes. Auth
  routes (`/api/auth/*`) have their own Upstash limiter; admin / org
  routes are not currently throttled at this layer.

### Exclusions

The following paths are **never** read-throttled, even when they would
otherwise match (`GET /api/...`):

| Path | Reason |
|------|--------|
| `/api/health` | Legacy health probe — operators must keep monitoring access during attacks. |
| `/api/livez` | Modern Kubernetes liveness probe (sibling of `/api/health`). |
| `/api/readyz` | Modern Kubernetes readiness probe. |
| `/api/docs` | Per GAP-17 spec — not a current route, but listing it here means a future docs surface ships unthrottled. |

The exclusion check is **prefix-with-slash match** (`path === excluded ||
path.startsWith(excluded + '/')`), so `/api/health` matches but
`/api/healthcheck` does NOT (defensive against accidentally widening
the exclusion to similar-prefixed paths). There's an explicit test for
this in `tests/unit/api-read-rate-limit.test.ts`.

## Bucketing

The read tier keys by **`(IP, userId, tenantSlug)`**. Two consequences:

- **Per-tenant isolation**: the same user accessing tenant A and
  tenant B has two independent budgets. A runaway tab in tenant A
  cannot starve the user's quota in tenant B.
- **Per-user isolation within a tenant**: 10 users in one tenant each
  get their own 120/min budget. A single bad actor cannot deny
  service to coworkers.

The auth tier keys by `(IP, ua-hash)` because it runs pre-authentication
(no `userId` available yet); the mutation tier keys by `(IP, userId)`
because it runs in-handler after the wrapper has resolved the user.

## 429 response shape

When the read tier is exhausted, the middleware returns a 429 with:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714328400000

{
  "error": {
    "code": "RATE_LIMITED",
    "scope": "api-read",
    "message": "Too many read requests. Retry after 47 seconds.",
    "retryAfterSeconds": 47
  }
}
```

The body **never** contains the IP, userId, or tenantSlug — those are
logged on the server side only. Clients get enough information to back
off intelligently and nothing extra. The `error.code` is stable across
all three tiers (`RATE_LIMITED`); `error.scope` distinguishes them
(`api-read` for this tier; `api-mutation` and `auth` for the others).

## Bypass gates (development & test)

Three env vars short-circuit rate limiting **for local dev and CI**:

| Env var | Effect |
|---------|--------|
| `RATE_LIMIT_ENABLED=0` | Operator override — disables ALL tiers. Never set in production. |
| `AUTH_TEST_MODE=1` | Set by Playwright + the e2e webserver. Skips auth + read tiers (mutation tier respects it via the wrapper). |
| `NEXT_TEST_MODE=1` | Belt-and-braces sibling of `AUTH_TEST_MODE` for the Next.js test build. |

Production cannot disable rate limiting without an explicit
`RATE_LIMIT_ENABLED=0`. Combined with [GAP-13](deployment.md) (Redis
required in production), this means a production deploy that boots at
all has rate limiting available.

## Tuning

If you need to adjust a budget:

1. **Find the preset** in `src/lib/security/rate-limit.ts` — this is
   the single source of truth for the auth-tier numbers (in the file)
   and the mutation/read tier numbers (`API_MUTATION_LIMIT`,
   `API_READ_LIMIT`).
2. **Change `maxAttempts` and/or `windowMs`** with a comment justifying
   the new values. Each preset already has a JSDoc threat-model note;
   keep that pattern.
3. **Re-run the tests**:
   - `tests/unit/api-read-rate-limit.test.ts` — read-tier behaviour
   - `tests/guardrails/api-read-rate-limit.test.ts` — structural shape
   - The mutation-tier tests in the same family

The `tests/guardrails/api-read-rate-limit.test.ts` ratchet specifically
asserts that `API_READ_LIMIT` has a 60-second window — anything longer
silently weakens the gate and would need an explicit ratchet update.

## Operational signals

Every blocked request emits a `warn`-level log line via the
edge-logger:

```
{ "level": "warn", "component": "rate-limit", "scope": "api-read",
  "tenantSlug": "acme-corp", "msg": "API read rate limit exceeded" }
```

The log line **does not include the IP or userId** (PII control). The
request-id stamped by middleware on every response ties the log entry
back to the offending caller for ops-side correlation.

For the auth tier, the same shape applies under
`component: 'rate-limit'` from `src/lib/observability/edge-logger.ts`.

For the mutation tier, the in-handler limiter logs at `debug` for
allowed and `warn` for blocked; same `component: 'rate-limit-middleware'`
namespace.

## Adding a new tier

1. Add the preset to `src/lib/security/rate-limit.ts` with a JSDoc
   threat-model note.
2. Re-export from `src/lib/security/rate-limit-middleware.ts` so the
   security barrel stays consistent.
3. **If applied at the Edge** (middleware): create a new module under
   `src/lib/rate-limit/` mirroring `apiReadRateLimit.ts` (Upstash +
   memory fallback). **If applied in route handlers**: use the
   existing `withRateLimit` wrapper.
4. Wire it into `src/middleware.ts` (Edge) or the relevant route
   handler (Node). Place edge checks AFTER auth gates — see the
   ratchet test for ordering rules.
5. Document the new tier here. Add a row to the table at the top.
6. Add a structural ratchet under `tests/guardrails/` mirroring
   `tests/guardrails/api-read-rate-limit.test.ts`.

## Horizontal scale checklist

A multi-instance deployment is only safe if **shared** rate/abuse state lives
in Redis, not in a per-process `Map`. When adding any counter, decide which
column it belongs in — and if it must be global, back it with the shared
Upstash client.

| State | Module | Backend | Multi-instance correct? |
|-------|--------|---------|-------------------------|
| Auth tier (login/session/csrf) | `authRateLimit.ts` | Upstash + memory fallback | ✅ shared |
| Read tier (tenant GETs) | `apiReadRateLimit.ts` | Upstash + memory fallback | ✅ shared |
| Mutation tier (`API_MUTATION_LIMIT`, `EXCHANGE_*`, MFA verify, invites, …) | `mutationRateLimit.ts` | Upstash + memory fallback | ✅ shared (Roadmap-5 PR1) |
| Credentials backoff | `credential-rate-limit.ts` | Upstash + memory fallback | ✅ shared |
| **Progressive login lockout** (Epic A.3) | `rate-limit.ts` | Upstash blob + memory fallback | ✅ shared (Roadmap-5 PR1) |
| AI generation quota | `aiRateLimit.ts` | Upstash + memory fallback | ✅ shared |
| Audit-stream per-tenant buffers | `audit-stream.ts` | in-process, **per-process BY DESIGN** | ⚠️ intentionally local |

**Why the audit-stream buffers stay local.** Each instance batches the audit
rows *it* committed and flushes them to the tenant SIEM independently. The
buffer is a delivery accelerator, not shared authority — the audit row is
already committed to Postgres before it enters the buffer, and every batch
carries a deterministic idempotency key (`X-Inflect-Batch-Id`) so a SIEM
dedupes across instances. Centralising it in Redis would add a network hop and
a new failure mode for zero correctness gain. On shutdown each instance drains
its own buffer (Epic E.3 graceful shutdown). **Do not migrate it.**

**Fallback contract.** With no `UPSTASH_REDIS_REST_*` env (or
`RATE_LIMIT_MODE=memory`), every shared limiter degrades to the in-process Map
— a single-node self-host stays zero-config and correct. The chosen backend is
logged once at boot (`rate-limit.backend`). Multi-instance operators MUST set
the Upstash env, or each instance enforces only its fraction of every budget.

## Cross-references

- **Production prerequisites**: [`docs/deployment.md`](deployment.md) — Redis is required (GAP-13).
- **Auth-tier details**: [`docs/auth.md`](auth.md) — login flow + brute-force protection.
- **Service-level objectives**: [`docs/slos.md`](slos.md) — production targets these limiters defend.
