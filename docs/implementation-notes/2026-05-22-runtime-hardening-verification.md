# 2026-05-22 — Runtime-hardening verification (roadmap-8)

**Commit:** `<pending> test(reliability): register redis-production-auth in the meta-ratchet`

## Design

Roadmap-8 arrived as a 4-prompt roadmap to fix three runtime risks:
BullMQ-unsafe Redis eviction policy in prod-like Compose,
unauthenticated Redis in prod-like Compose, and `livez`/`readyz`
probes coupled to the full Next.js stack.

**Verification found all three already remediated, guarded, and
documented** — the roadmap's source (`docs/roadmap-audit-2026-05-13.md`)
predates the fixes. This note is the verification record, in the
spirit of `docs/dependency-risk-review.md`: "verified clean" is a
legitimate, documented outcome.

### P1 — Redis eviction policy → already `noeviction` everywhere

Every Compose file pins `--maxmemory-policy noeviction`:
`docker-compose.yml` (dev, 128mb), `docker-compose.staging.yml`
(256mb), `docker-compose.prod.yml` (512mb),
`deploy/docker-compose.prod.yml` (256mb); `docker-compose.test.yml`
sets no `maxmemory` cap so eviction never triggers. No file uses
`allkeys-lru`. `src/lib/redis.ts::verifyRedisEvictionPolicy` is a
runtime startup check wired in `src/instrumentation.ts`. The
structural ratchet `tests/guards/redis-eviction-policy.test.ts` and
the per-environment table in `docs/deployment.md` complete the
picture. Shipped by roadmap-2's #620.

### P2 — Redis auth → already `requirepass` with fail-fast

Every production-like Compose file runs
`redis-server --requirepass "${REDIS_PASSWORD:?…}"` — the `:?`
syntax aborts `docker compose up` before the container is created if
`REDIS_PASSWORD` is unset. The app `REDIS_URL` is built from it
(`redis://:${REDIS_PASSWORD}@redis:6379`). `docs/deployment.md`
documents it per-environment; `tests/guards/redis-production-auth.test.ts`
is the structural ratchet. Shipped by #604.

### P3 — health probes → liveness/readiness already separated

`src/app/api/livez/route.ts` performs **zero** dependency checks —
it returns `{ status: 'alive', uptime }` purely to confirm the event
loop is responsive (the documented contract). `src/app/api/readyz/route.ts`
checks Postgres + Redis + S3, each with a 2 s timeout, and returns
503 with the failed component named. The liveness-vs-readiness split
is implemented and documented (GAP-13).

### The one genuine gap — and the fix

`redis-eviction-policy.test.ts` is registered in the
`observability-reliability-integrity` meta-ratchet (#621);
`redis-production-auth.test.ts` — its sibling — was **not**. The
Redis-auth guardrail was therefore not itself guarded against
deletion. This change registers it, so both Redis runtime-safety
ratchets are now under the "guard the guards" meta-ratchet.

## Files

| File | Role |
|------|------|
| `tests/guards/observability-reliability-integrity.test.ts` | `redis-production-auth.test.ts` added to the `GUARDRAILS` registry (2 → 3); completeness assertion updated. |
| `docs/implementation-notes/2026-05-22-runtime-hardening-verification.md` | This verification record. |

## Decisions

- **Verified-clean is a real outcome.** Roadmap-8's three fixes were
  already in place. Re-touching correct config to manufacture four
  PRs would be dishonest churn. The maintainer was shown the
  evidence and chose the single genuine deliverable.

- **The gap that was real is the one worth fixing.** A guardrail
  that exists but is not itself meta-guarded is exactly the
  silent-erosion class the meta-ratchets were built to close — so
  `redis-production-auth.test.ts` belongs in the registry. Small,
  but genuine.
