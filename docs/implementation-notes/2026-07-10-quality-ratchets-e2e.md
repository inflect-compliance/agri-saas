# 2026-07-10 — Cross-layer quality ratchets + mobile drift guard

**Commit:** `<sha> feat(quality): lifecycle-sweep + cross-tenant harness + drift ratchet + CLAUDE.md reconcile`

## Design

Closes several of the quality gaps above the unit layer with STRUCTURAL
ratchets (the repo's idiom) plus a mobile e2e drift guard.

- **Lifecycle-sweep ratchet** (`tests/guardrails/lifecycle-sweep-coverage.test.ts`)
  — reads the live Prisma schema, finds every model whose status enum contains
  `EXPIRED` AND which carries an `expiresAt` column, and asserts it maps to a
  registered job in `schedules.ts`. Today: `ControlException` →
  `exception-expiry-monitor`, `ExchangeListing` → `exchange-expiry-sweep`. A new
  expiry-shaped model can't ship without wiring its sweep (or a reasoned
  exception). A model that promises "flips to EXPIRED at the deadline" but has no
  sweep is a correctness AND security bug (an access grant that never expires).

- **Parameterized cross-tenant guard harness**
  (`tests/helpers/cross-tenant-guard.ts`) — extracts the `exchange-route-guard`
  pattern into `assertCrossTenantGuard(spec)`: replay tenant A's context against
  a tenant-B-owned resource (ids in path/body) and assert 403/404 + zero
  mutation. The exchange routes are refactored through it (proving the factory);
  seeding a new privileged route is now a spec object, not bespoke boilerplate.

- **Horizontal-drift e2e ratchet** (`tests/e2e/mobile/horizontal-drift.spec.ts`)
  — `@mobile`, read-only. Asserts `documentElement.scrollWidth <= viewport (±1px)`
  across the key field surfaces. Commit #210 fixed this class by hand; nothing
  stopped recurrence. One line per page in `PAGES` guards it forever — the mobile
  equivalent of the repo's structural ratchets.

- **CLAUDE.md reconciliation** — the Field Encryption section said `$use`
  middleware; it migrated to `$extends({ query })` in Prisma 7
  (`src/lib/prisma.ts`). Fixed, and added the standing convention: **a PR that
  invalidates a CLAUDE.md claim updates it in the same diff** — a stale operating
  manual sends the next engineer down a path the code no longer supports.

## Decisions

- **Structural ratchets over brittle assertions.** Each ratchet reads the LIVE
  schema / source, so it can't drift out of sync with a curated list.
- **The cross-tenant harness is a factory, seeded, not exhaustive.** The exchange
  routes prove it; extending to the full privileged-route set (admin sessions,
  billing, vendor/control/risk, invites) is mechanical follow-up — each is a
  `CrossTenantGuardSpec` with its own repo mock.

## Deferred (environment-bound)

The following require infrastructure this authoring sandbox lacks (a Playwright
browser; a coverage run that doesn't OOM), so they are scoped as follow-up
rather than shipped unvalidated:

- The four full journey specs (invite→role-gated; farm-task→journal→PDF @mobile;
  admin session revoke→sign-out; module-gate @mobile via BottomTabBar).
- Seeding the remaining ~8 privileged routes into the cross-tenant harness.
- The coverage-floor bump to measured-minus-2 — needs a `test:coverage` run to
  measure HEAD's actual coverage before raising `jest.thresholds.json`.
