# KPI Filterables — Roadmap 23

Clickable KPI cards that drive table filtering, modeled on the Risks
page. Seven list pages mount the same primitive (`<KpiFilterCard>`)
and the same hook (`useKpiFilter`); per-page differences live only
in the KPI definitions.

## Decision tree — when to add a new KPI

1. **Does the page already use `FilterContextValue`?** If not, wire
   it up first (see `src/components/ui/filter/GUIDE.md`). KPI cards
   are typed shortcuts over filter state — without a filter context
   there's nothing to shortcut.

2. **Is the KPI's "set" expressible as one or more filter-key
   assignments?** Yes for status/criticality/lifecycle buckets.
   No for cross-entity counts, computed averages, scoring rollups —
   those are READ-ONLY metrics; render them with the static
   `<KpiFilterCard>` shape (no `onClick`).

3. **Pick a stable id.** A short kebab-case literal that ends up in
   the typed union. Examples: `total`, `open`, `overdue`,
   `dueWeek`, `critical`.

4. **Write `isActive(state)` as a pure predicate.** Read filter
   state, return boolean. Keep it cheap — the hook calls it on
   every re-render. Most KPIs reduce to
   `(state.X ?? []).includes('VALUE')`.

5. **Write `apply(ctx)` to set the filter shortcut.** Use
   `ctx.set(key, value)` for single-value targets; `ctx.add` for
   multi-add scenarios.

6. **Define `clear(ctx)` IF the KPI owns specific keys.** Default
   fallback (omitting `clear`) calls `ctx.clearAll()` — correct only
   for the implicit-default "total" KPI. Status-bucket KPIs almost
   always want `clear: (ctx) => ctx.removeAll(KEY)` so toggling off
   preserves sibling filters and search.

7. **Add the card to the page's KPI strip grid.** Standard layout:

   ```tsx
   <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
     <KpiFilterCard
       label="Open"
       value={openCount}
       tone="attention"
       onClick={() => toggleKpi('open')}
       selected={activeKpiId === 'open'}
     />
   </div>
   ```

## When NOT to add a KPI

- **Single-value metrics on a non-list page** (dashboard tiles
  belong on the dashboard `KpiCard` chassis, not the filter-card
  primitive).
- **Computed metrics with no filter mapping** (avg score, total
  weighted exposure — these are static `<KpiFilterCard>` cards
  without `onClick`).
- **Per-row state KPIs** (assigned-to-me) — usually expressible via
  the existing assignee filter, no new KPI needed.

## URL contract

KPI activation is **derived state**, not stored state. The
underlying `FilterContextValue` URL-syncs all filter keys; the
hook re-evaluates `isActive(state)` on every render to compute
`activeKpiId`. There is **no** `?kpi=<id>` URL param — that would
create a second source of truth that can drift from filter state.

Consequence: refresh / share / back-navigation restore the active
KPI for free because the underlying filter values are in the URL.
A user clicking "Open" on the Risks page can copy the URL with
`?status=OPEN`; opening that URL on another browser reactivates
the "Open" KPI card via the `isActive` re-evaluation.

## Mutual-exclusion contract

Two KPI defs whose predicates both report `isActive(state) === true`
for the same state cause `activeKpiId` to resolve to `null`. The
hook does NOT silently pick a winner — the page author owns
mutual exclusivity by defining non-overlapping predicates.

In practice this means: if you have a `status=OPEN` KPI and a
`severity=CRITICAL` KPI, applying status=OPEN AND severity=CRITICAL
externally (via the filter toolbar) deactivates both cards.
Documented behaviour; no special handling needed.

## Test layout

| Layer | File | Owns |
|---|---|---|
| Primitive | `src/components/ui/kpi-filter-card.tsx` | Visual shape |
| Hook | `src/components/ui/kpi-filter/use-kpi-filter.ts` | Filter model |
| Structural ratchets | `tests/guards/r23-pr{a..f}-*.test.ts` | API surface lock |
| Behavioural unit | `tests/rendered/use-kpi-filter*.test.tsx` | Toggle / isActive / coexistence |
| Per-page lock | `tests/guards/r23-pr{d,e,f}-*-rollout.test.ts` | Consumer page wired correctly |
| Capstone | `tests/guards/r23-prf-policies-vendors-capstone.test.ts` | All 6 ratchets + 7 consumers exist |

A new consumer page MUST add itself to `ALL_R23_CONSUMERS` in the
capstone ratchet — otherwise the meta-lock isn't catching its KPI
strip.

## Adding a new consumer page

1. Write the KPI defs (see decision tree above).
2. Mount the `<KpiFilterCard>` row above the page's filter
   toolbar:
   - Pages on `ListPageShell`: render inside
     `<ListPageShell.Filters className="space-y-section">` above
     the `<FilterToolbar>`.
   - Pages on `EntityListPage`: pass the cards via the `kpis` slot
     prop (added in R23-PR-D).
3. Add the page path to `ALL_R23_CONSUMERS` in
   `tests/guards/r23-prf-policies-vendors-capstone.test.ts`.
4. Write a per-page ratchet in `tests/guards/` (5 assertions: the
   imports + invocation + JSX + total KPI presence).
