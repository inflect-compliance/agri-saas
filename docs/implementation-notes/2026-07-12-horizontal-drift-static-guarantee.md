# 2026-07-12 — Horizontal-drift static guarantee (bug class #210)

**Commit:** `<pending> test(mobile): static guard + e2e coverage for horizontal drift`

## Design

Mobile horizontal drift (a page that slides left/right on a phone) was
fixed by hand in commit #210 and guarded only by
`tests/e2e/mobile/horizontal-drift.spec.ts`, which measured live
`scrollWidth` on ~15 of ~130 routes and needs a browser + DB. Nothing
caught the ROOT-CAUSE markup at author time. This adds a purely static
sibling and widens the e2e net.

Two layers, same bug class:

- **Static guard** `tests/guards/no-horizontal-drift-patterns.test.ts`
  — a text scan of `src/` (no DOM), a sibling to the repo's other
  structural ratchets. Three patterns:
  - **(a) Uncompensated layout-scale negative margin.** A
    `-mx-`/`-ml-`/`-mr-` of layout magnitude (>= 2 Tailwind units) OR
    any horizontal negative margin sitting on a scroll container
    (`overflow-y-auto`/`overflow-auto` in the same class list) must be
    compensated on the SAME element by inner padding
    (`px-`/`pl-`/`pr-`) OR an overflow clip
    (`overflow-x-hidden`/`overflow-hidden`). Button-icon nudges
    (`icon={<Plus className="-ml-0.5 -mr-2.5" />}`) and hairline
    micro-margins (< 2 units, e.g. `-mx-1` separators) are exempt.
    `COMPENSATED_SITES` documents every current compensated site with a
    reason; a new compensated site must be added there (completeness),
    and a stale/decompensated entry fails.
  - **(b) Raw `<table>` without a scroll ancestor.** A bare `<table>`
    whose file has no `overflow-x-auto`/`overflow-auto` wrapper
    overflows a phone. `RAW_TABLE_ALLOWLIST` carries the three
    `TraceabilityPanel` sub-tables (a later prompt migrates them to
    `<DataTable>`). Print surfaces (`/print/`) and the
    `src/components/ui` table primitives are out of scope.
  - **(c)** `globals.css` keeps `overscroll-behavior-x: none`.
  Each layer carries a self-test proving the detector catches a
  synthetic offender.

- **e2e widening.** `horizontal-drift.spec.ts` grows from 6 to ~20
  static routes (grain, admin matrices, risk board/hierarchy, mapping,
  notifications, …), adds detail-page coverage that resolves the first
  entity from its list via the title-cell `<Link>` anchor (skips when
  the seed is empty), adds task-create + journal-entry modal-open
  states beside the existing create-offer one, and a new
  unauthenticated block for the auth/entry surfaces (login, tenants,
  no-tenant, invite preview).

## Files

| File | Role |
| --- | --- |
| `tests/guards/no-horizontal-drift-patterns.test.ts` | New static ratchet (a/b/c) + self-tests + baselines |
| `tests/e2e/mobile/horizontal-drift.spec.ts` | Extended PAGES + detail pages + modal states + auth surfaces |

## Decisions

- **Magnitude >= 2 for (a), not a strict "inside a scroll container"
  ancestor walk.** A reliable static ancestor walk over ternary
  `className` strings is brittle. Scoping to layout-scale margins (plus
  the same-line scroll-container case) is deterministic, low-false-
  positive, and catches the two real shapes: scroll containers with an
  uncompensated `-mx-` AND full-bleed `-mx-4` maps. It flags exactly the
  five current compensated sites (widget-dispatcher, FrameworkExplorer,
  dashboard-sections, the locations map, OfflineFieldPanel), all already
  compensated — zero live offenders. `-mx-1` hover-row micro-margins
  (MyFarmTasksCard / RecentJournalCard) are below the threshold and
  intentionally out of scope: too small to drift, compensated anyway.
- **File-level overflow check for (b)**, matching the spec's "ancestor
  in the same file". Every wrapped table in the repo has its
  `overflow-x-auto` within a few lines of the tag; admin/rbac +
  admin/roles wide matrices are already wrapped, so no fix was needed —
  only `TraceabilityPanel` (unwrapped, pending migration) is
  allowlisted.
- **e2e stays READ-ONLY on the shared seeded tenant.** Detail pages
  resolve their URL from the list rather than seeding via UI (brittle,
  and the shared seed lacks vendors/journal/locations/field tasks). Un-
  seeded detail types skip cleanly; coverage grows as the seed grows.
  Opening a create modal is not a mutation, so the modal-drift checks
  need no isolated tenant.
