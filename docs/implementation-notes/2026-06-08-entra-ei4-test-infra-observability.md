# 2026-06-08 — Entra ID Test Infrastructure & Operational Observability (EI-4)

**Commit:** `<sha>` feat(auth): Entra/SCIM observability + group-claim resolver test infra (EI-4)

## Why

EI-1 landed the Entra group-claim pipeline (`token.aadGroups` populated at
sign-in, overage → Graph fallback) but deferred two things to EI-4:

1. **The full jwt-callback integration test** — EI-1 unit-tested the pure Graph
   helper, but the *decision* around it (inline claim vs overage fetch vs
   fail-open) lived inline in the `auth.ts` `jwt` callback, which is a large
   closure that's impractical to invoke in a unit test.
2. **Operational observability** — the two Entra/SCIM paths that can silently
   degrade (a Graph outage failing open to `[]`; SCIM bearer-token auth
   failures) had structured logs but no OTel metrics, so they were invisible to
   dashboards/alerts.

## Design

**Extract → test → observe.** The `microsoft-entra-id` branch of the jwt
callback now delegates to `resolveEntraGroupClaims` in a new
`src/lib/auth/entra-group-claims.ts`. That function is pure +
dependency-injected (`fetchImpl`, `now`), so EI-4 can exercise every branch
without NextAuth, and it's the single home for the group-resolution metric +
log. The module is still loaded via dynamic `import()` from the callback, so its
OTel-API / Graph dependencies never bundle into the edge runtime (same boundary
EI-1 used for `entra-graph`).

Two metric families were added to `src/lib/observability/metrics.ts`, mirroring
the existing `recordAuditStreamDelivery` lazy-singleton pattern (no tenantId
label — fleet-health signal; per-user/tenant debugging uses the structured log
in the same path):

- `auth.entra.group_resolution` (counter, `source`×`outcome`) +
  `auth.entra.group_count` (histogram, `source`) +
  `auth.entra.graph_fetch.duration` (histogram, `outcome`, overage-only).
  `source=graph_overage, outcome=empty` is the Graph-outage alert signal — the
  Graph helper fails open to `[]`, so an overage user resolving to zero groups
  almost always means the Graph call failed.
- `scim.auth.count` (counter, `outcome`×`reason`) recorded at every terminal
  branch of `authenticateScimRequest`. `reason` is a bounded 5-value enum
  (`ok`/`missing_header`/`empty_token`/`not_found`/`revoked`); a `not_found`
  spike is the brute-force / stale-connector signal.

**Test infrastructure (Part A).** `tests/helpers/entra.ts` is the shared Entra
fixture library — `buildEntraProfile` (inline claim), `buildEntraOverageProfile`
(`_claim_names` overage), `buildEntraAccount`, and `graphMemberOfFetch` /
`graphFailFetch` / `graphThrowFetch` mock `fetch` builders — so Entra tests stop
hand-rolling drifting profile/Graph shapes.

## Files

| File | Role |
| --- | --- |
| `src/lib/auth/entra-group-claims.ts` | **New.** Pure, observable `resolveEntraGroupClaims`. |
| `src/auth.ts` | jwt callback delegates the entra-id branch to the resolver. |
| `src/lib/observability/metrics.ts` | **New recorders** `recordEntraGroupResolution`, `recordScimAuth` + header doc. |
| `src/lib/scim/auth.ts` | Records `scim.auth.count` at each terminal branch. |
| `tests/helpers/entra.ts` | **New.** Shared Entra fixture library (Part A). |
| `tests/unit/entra-group-claims.test.ts` | **New.** The deferred jwt-callback path coverage. |
| `tests/unit/scim-auth-metrics.test.ts` | **New.** SCIM auth metric wiring. |
| `tests/unit/observability-metrics.test.ts` | Branch coverage for the new recorders. |
| `tests/guards/entra-ei1-group-claims.test.ts` | Relocated overage assertions to the resolver module. |
| `tests/guards/entra-ei4-observability.test.ts` | **New ratchet.** Locks the EI-4 wiring. |

## Decisions

- **Resolver over inline + heavy callback mock.** Testing the real jwt callback
  would mean mocking Prisma, membership claims, MFA, and session recording for
  one small branch. Extracting the decision is the smaller, more durable change
  and gives observability a clean seam — it's the same move EI-1 made for
  `fetchUserGroupsFromGraph`.
- **`outcome=empty` instead of a separate failure metric.** The Graph helper
  fails open to `[]` by contract (a Graph outage must never block sign-in), so
  the resolver cannot distinguish "no groups" from "fetch failed". On the
  overage path the two collapse: an overage user genuinely has groups, so
  `graph_overage + empty` is a high-signal outage proxy without changing the
  fail-open contract.
- **No tenantId metric labels.** Both families are fleet-health signals; tenant
  cardinality would explode the series count. Tenant context stays in the
  structured logs in the same code paths.
- **EI-4 guard is its own domain ratchet**, not folded into the
  observability-reliability meta-ratchet (that registry is the backend
  runtime-reliability surface; this is the auth/identity surface).
