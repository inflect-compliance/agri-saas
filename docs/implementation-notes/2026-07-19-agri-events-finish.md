# 2026-07-19 — AgriEvent: finish it (nav honesty + platform-admin curation)

**Commit:** `<pending>` feat(events): populate + curate the global agriculture-events catalogue

## The fork: FINISH, not RETIRE

`/events` rendered "No upcoming events" in every environment. Verified, not
assumed — production (`inflect_production`) held **0 `AgriEvent` rows** against
1 tenant, behind a permanent sidebar entry. The whole surface landed in one PR
(#194) and was never touched again: it shipped incomplete rather than decayed.

**Decision: (a) FINISH.** The reasoning, in order of weight:

1. **Everything except population already worked.** A clean read usecase
   (`assertCanRead` + take-clamp + a correct "upcoming" predicate), a faithful
   page with safe external links and an empty state, full en/bg parity with real
   Bulgarian, a 4-row seed already using exactly the right categories, and the
   model + migration. Retiring would have deleted a working feature to avoid
   finishing a thin remainder — wiring and a write path.
2. **It is not an orphan.** `Promotion` is its structural twin (global, no
   `tenantId`, "seeded / admin-posted"), and the two models' docblocks cite each
   other as precedent — `promotions.prisma:3` names `AgriEvent` explicitly.
   Deleting `AgriEvent` would strand that reference and leave half a documented
   pattern.
3. **The value case is specific and real.** ДФЗ/ПРСР subsidy deadlines have
   direct financial consequence for a Bulgarian farm. Fairs alone would be
   marginal; deadlines are not.

**Sibling finding, deliberately out of scope.** `Promotion` has the *identical*
defect — 0 rows in production, a `scripts/seed-promotions.ts` wired into
nothing, and the same fictional "admin tooling" comment. This PR does not fix
it. The seam built here (composable seed + platform-admin route + nav gate)
transfers directly if that is picked up.

## What "admin tooling" turned out to mean

The comments promised a curation surface that did not exist. Two constraints
shaped what replaced it:

**There is no platform-admin UI anywhere in the repo.** Platform-admin is
API-only: two routes, gated by an `x-platform-admin-key` header with no session
(`src/lib/auth/platform-admin.ts`). Building "a minimal admin page" would have
meant inventing the first UI authentication surface for a header credential — a
new security surface, disproportionate to curating a fairs list. So curation is
**three key-gated API routes** following the `api/admin/tenants` shape exactly,
and the comments now point at them.

**The writes are NOT in `AuditLog`, because they cannot be.** `AuditLog.tenantId`
is non-nullable with an FK to `Tenant`, and the chain is anchored per tenant via
`pg_advisory_xact_lock(hashtext(tenantId))`. A global catalogue has no tenant to
hang a row on, and all three workarounds are wrong: a sentinel tenantId dangles
the FK, a synthesized `RequestContext` is the anti-pattern `tenant-lifecycle.ts`
explicitly documents against, and one row per tenant records a single global fact
N times. The platform-admin precedent has two halves — an `appendAuditEntry`
against the affected tenant, and a `logger.info` — and only the second half
applies here. If this ever needs a tamper-evident ledger, the template is
`OrgAuditLog` + `org-audit-writer.ts`, which is how the repo already solves
"audit something that isn't tenant-scoped".

## Nav honesty

The Events entry is now `visible: tenant.agriEventsAvailable !== false`,
resolved server-side in `TenantLayout` and passed through tenant context.

- **Server, not a client fetch.** `useCalendarBadge` is the only data-driven nav
  precedent, and it *decorates* (a badge) rather than *hides*. A client fetch
  driving `visible` would make the entry appear and then vanish on every page
  load, and its `NEXT_PUBLIC_TEST_MODE` opt-out would silently change nav
  visibility in tests.
- **Zero added latency** — it joins the layout's existing `Promise.all`.
- **Memoised in-process, 60s TTL.** The answer is identical for every tenant and
  user (it depends only on the catalogue and the clock), while the layout is
  `force-dynamic` + `noStore()` for permission freshness — without a memo this
  would be one redundant query per navigation per user across the fleet. Every
  curation write drops the memo, so a newly-posted event appears immediately.
  A cached `true` can briefly outlive the last event; that is harmless, because
  the nav gate is a polish affordance and the page keeps its own empty state.
- **`!== false`, not truthiness** — an older provider that doesn't set the flag
  still shows the entry, matching the `availableModules` degrade convention.

## Two falsified premises

- **The "intentionally global, no-RLS allowlist" does not exist.** There is no
  array naming Unit/SoilSample/Promotion. Every RLS and index guardrail *derives*
  its inventory from models that HAVE a `tenantId`, so a tenant-less table is
  auto-excluded — and `2026-07-15-trends-data-backbone.md:103` already recorded
  this exact discovery, concluding "add no tenantId, add no list entries".
  The *intent* (make the design sanctioned rather than implicit) is still sound,
  because those guardrails work by subtraction: "no tenantId" is
  indistinguishable from "forgot the tenantId". So the intent is met by a new
  **positive** guardrail, `tests/guardrails/global-catalogue-models.test.ts`,
  which names the four deliberately-global models with reasons and fails if one
  gains a `tenantId`, is deleted, or enters the RLS inventory. It is deliberately
  a separate file, not a new exception list inside `rls-coverage.test.ts`, so the
  trends precedent stands.
- **The seed script was not composable.** It was a standalone entrypoint with its
  own `PrismaClient`, not the `importUnits(prisma)` shape the composed seeds
  import. Refactored to export `seedAgriEvents(prisma)` while keeping the
  standalone path via `require.main === module` (the `import-units.ts`
  convention).

## The subsidy-deadline import job (iii) — deliberately not built

The optional MZH/ДФЗ importer was skipped. The RSS/feed research earlier in this
roadmap series hit a real availability and licensing wall for Bulgarian
agricultural sources, and no verified feed URL exists today. Shipping an importer
pointed at a guessed endpoint would have recreated precisely the defect this PR
exists to fix: a plausible-looking mechanism wired to nothing. It needs a
confirmed source first.

Relatedly, the demo seed rows are now explicitly marked as such. One of them is a
**fabricated** "CAP direct payments — application deadline" with a synthetic
date; a farmer who trusted it could miss the real one. All three wiring targets
(`prisma/seed.ts`, `seed:demo`, `seed:staging`) are dev/demo/staging — verified,
`prisma/seed.ts` seeds `admin@acme.com`/`password123` and notes prod users come
via OAuth — and the seed header now states that production is curated exclusively
through the admin API.

## Files

| File | Role |
|------|------|
| `src/app-layer/schemas/agri-event.schemas.ts` | **New** — `AGRI_EVENT_CATEGORIES` (the curated set, single source), create/update zod schemas. |
| `src/app-layer/usecases/agri-events.ts` | `hasUpcomingAgriEvents` (memoised probe) + the three platform-admin writes; docblock now describes the real population paths. |
| `src/app/api/admin/agri-events/route.ts` | **New** — key-gated POST. |
| `src/app/api/admin/agri-events/[id]/route.ts` | **New** — key-gated PATCH/DELETE. |
| `scripts/seed-agri-events.ts` | Refactored to `seedAgriEvents(prisma)`; typed `category`; demo-only warning. |
| `prisma/seed.ts`, `scripts/seed-demo.ts` | Call the seed (staging inherits via its `require`). |
| `src/lib/tenant-context-provider.tsx`, `src/app/t/[tenantSlug]/layout.tsx`, `src/components/layout/SidebarNav.tsx` | The nav gate. |
| `prisma/schema/agriculture.prisma`, `.../events/page.tsx` | The two remaining "admin tooling" comments corrected. |
| `tests/guardrails/global-catalogue-models.test.ts` | **New** — positive pin on the tenant-less design. |
| `tests/unit/agri-events-admin.test.ts` | **New** — write-path + memo behaviour. |
| `tests/guardrails/api-permission-coverage.test.ts`, `tests/unit/no-direct-prisma.test.ts` | Registered the new routes / the global-handle use, with reasons. |

## Follow-up

The page still resolves `category` through a `switch` with a `default:` arm that
silently labels anything unknown as a fair — now a genuine read/write asymmetry,
since the write side is closed. That, the behavioural tests for
`listUpcomingAgriEvents`, `formatDateRange`, the shell decision and the
command-palette entry are the next PR.
