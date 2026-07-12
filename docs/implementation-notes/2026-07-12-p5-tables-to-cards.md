# 2026-07-12 — P5: tables become cards on mobile

**Commit:** `<pending> feat(mobile): roll out DataTable card fallback to list pages`

## Design

Mobile-hardening roadmap P5. A horizontally-scrolling table is unusable on a
390px phone — the worst mobile-feel bug for a field user (agri-saas users are
Bulgarian farmers/traders on rural LTE). `<DataTable>` already supported
`mobileFallback="card"` (each row → a tappable card driven by
`column.meta.mobileCard` slot descriptors) but it was opt-in and only wired
into a handful of pages. P5 rolls it out to every remaining list page and locks
the contract with a structural ratchet.

Five parts:

- **P5.1 — rollout.** Every list-page `<DataTable>` render site under
  `src/app/**` now sets `mobileFallback` explicitly. Most got `"card"` with
  `meta.mobileCard` on 3-5 columns (title + status pill + a few key/value
  rows). Three genuinely wide numeric grids stay `"scroll"` with a code-comment
  justification: grain **yield** matrix, grain **costs** breakdown (×3 tables),
  and the org **portfolio-grain** per-farm grid — their figures only make sense
  read side-by-side.
- **P5.2 — guard.** `tests/guards/datatable-mobile-fallback.test.ts` scans
  `src/app/**` for DataTable render sites (`<DataTable>` JSX or an
  `EntityListPage` import) and fails any that don't explicitly set
  `mobileFallback`. `card` must carry `mobileCard` meta; `scroll` must carry a
  written-reason comment. Non-list DataTables (dashboards, detail sub-tables,
  wizards, sub-components) are curated in `EXEMPTIONS`; a "no stale entries"
  test keeps that honest, plus in-memory mutation self-tests.
- **P5.3 — TraceabilityPanel.** Its three legacy raw `<table>` elements
  (linked risks / controls / assets) became `<DataTable mobileFallback="card">`.
  The Epic 67 undo-toast unlink flow is preserved verbatim (now an `actions`
  card slot). The three `RAW_TABLE_ALLOWLIST` entries in
  `no-horizontal-drift-patterns.test.ts` were removed in the same diff.
- **P5.4 — card affordances.** `MobileCardList` already rendered a 44px-min
  `role="button"` card with a focus ring; P5.4 adds a `ChevronRight` glyph on
  the right rail of clickable cards (rows that navigate) so the tap-through
  affordance is visible. Non-navigating cards (e.g. the farm-tasks field queue)
  get no chevron.
- **P5.5 — e2e.** `tests/e2e/mobile/lists.spec.ts` gains a single-session
  `@mobile` test that walks risks/controls/vendors/evidence/findings via
  `test.step`, asserting each renders as cards (no horizontal overflow) and
  that risks/controls/vendors tap through to their detail route. One login for
  the whole block — the per-route-login budget lesson from the drift spec.

## Files

| File | Role |
| --- | --- |
| `src/components/ui/table/mobile-card-list.tsx` | P5.4 — chevron affordance on clickable cards |
| `src/components/TraceabilityPanel.tsx` | P5.3 — 3 raw tables → DataTable card mode |
| `src/app/t/[tenantSlug]/(app)/**` + `src/app/org/[orgSlug]/(app)/**` (list pages) | P5.1 — `mobileFallback` + `mobileCard` meta |
| `tests/guards/datatable-mobile-fallback.test.ts` | P5.2 — the coverage ratchet |
| `tests/guards/no-horizontal-drift-patterns.test.ts` | P5.3 — emptied `RAW_TABLE_ALLOWLIST` |
| `tests/e2e/mobile/lists.spec.ts` | P5.5 — card-mode e2e for more pages |

## Decisions

- **File-level guard, not per-`<DataTable>`-instance.** Mirrors the sibling
  `list-page-shell-coverage` ratchet. A file that renders any card table must
  carry `mobileCard` meta; a file that uses scroll must carry a reason comment.
  Simpler and more robust than parsing each JSX element's prop bag; the few
  multi-table files are handled correctly because both conditions hold at file
  scope.
- **`scroll` justification lives in a code comment, not a curated allowlist.**
  The reason belongs next to the table it explains. Only three files use it.
- **No new i18n strings.** `mobileCard` `meta.label` reuses each column's
  existing `header:` translation expression; where a header is a raw string
  literal (pre-existing debt on a few admin/vendor/finding tables) the label is
  omitted and the card falls back to the header text. So P5 added zero keys to
  `messages/{en,bg}.json`.
- **TraceabilityPanel rows typed, not `any`.** Introduced `LinkedRiskRow` /
  `LinkedControlRow` / `LinkedAssetRow` so the new column cells read
  `row.original.*` without new `as any` casts (the `as any` ratchet stays put).
