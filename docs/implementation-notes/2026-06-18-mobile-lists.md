# 2026-06-18 — Mobile lists PR-2: card fallback + mobile filters

**Commit:** `<sha> feat(mobile-lists): DataTable card fallback + filter bottom-sheet`

Second of the 6-PR mobile initiative. Goal: kill horizontal-scroll tables
on phones; make lists tappable cards.

## Design

### Card fallback (the primitive)
`<DataTable mobileFallback="card">` (default `'scroll'`). Below `sm`, each
row renders as a full-width tappable CARD; at `sm`+ the normal table
renders. New `MobileCardList` (`src/components/ui/table/mobile-card-list.tsx`)
+ a TanStack `ColumnMeta` augmentation drive it:

```ts
meta: { mobileCard: { slot: 'title' } }                // heading
meta: { mobileCard: { slot: 'subtitle' } }             // secondary line
meta: { mobileCard: { slot: 'status' } }               // pill, top-right
meta: { mobileCard: { slot: 'meta', label: 'Due' } }   // key/value row
```

The card is NOT a second column config — it reuses each tagged column's
existing `cell` renderer (status pills, formatted dates carry over), so
tagging is one `meta` line per column. Untagged columns (select, actions,
dense numerics) are omitted. The card list (`sm:hidden`) sits beside the
table (`hidden sm:contents`) so the table's `fillBody` flex chain is
untouched at `sm`+; scroll mode adds NO wrapper (purely additive).

A clickable card is a `<div role="button" tabIndex=0>` (NOT a `<button>`):
some title cells embed a same-destination `<Link>` (Tasks/Journal) and
`<button><a>` is invalid HTML — a div may legally contain a link;
Enter/Space are wired for keyboard parity. Tap-through reuses the table's
existing `onRowClick`.

### Mobile filters (already a platform primitive — not rebuilt)
The prompt asked to "move filters into a vaul bottom-sheet + chips + sticky
search." The existing responsive `FilterToolbar` already delivers this on
mobile: the shared `Popover` swaps to a **vaul bottom-`Drawer`** when
`isMobile` (`src/components/ui/popover.tsx`), so the "Filter" button opens a
bottom-sheet containing the filter categories + the live search; and
`FilterUI.List` already renders the active-filter chip strip above the list.
A standalone search bar is BANNED by `tests/guards/r14-no-page-searchbars`
(search must live inside the filter dropdown). So Part B is verified +
asserted in E2E, NOT duplicated.

## Files

| File | Role |
| --- | --- |
| `src/components/ui/table/mobile-card-list.tsx` | New. `ColumnMeta.mobileCard` augmentation + the card renderer. |
| `src/components/ui/table/data-table.tsx` | `mobileFallback` prop + the card render branch. |
| `src/components/layout/EntityListPage.tsx` | 1-line: add `mobileFallback` to the `Pick<DataTableProps>` passthrough. |
| `tasks/TasksClient.tsx` | title/status/2 meta; `mobileFallback="card"`; onRowClick→`/tasks/<id>`. |
| `farm-tasks/FarmTasksClient.tsx` | title/subtitle/status/meta; card mode. No detail route ⇒ non-clickable cards. |
| `locations/[locationId]/page.tsx` | parcels sub-table: title/2 meta; card mode. No detail route ⇒ non-clickable. |
| `inventory/InventoryClient.tsx` | lot/subtitle/2 meta; card mode; onRowClick opens the lot modal. |
| `journal/JournalClient.tsx` | title/subtitle/status/2 meta; card mode; onRowClick→`/journal/<id>`. |
| `tests/e2e/mobile/lists.spec.ts` | `@mobile`: no-h-scroll + tap-through (Tasks) + parcels no-h-scroll + filter bottom-sheet. |
| `tests/rendered/mobile-card-list.test.tsx` | Unit: card slots, tap-through, scroll-mode unaffected. |

## Decisions

- **Card driven by column meta, reusing cell renderers.** One `meta` line
  per column; zero duplication of formatting/status logic. The augmentation
  co-merges cleanly with the existing `disableTruncate`/`headerTooltip`
  `ColumnMeta` augmentation.
- **`display:contents` wrapper at sm+** so the table's `fillBody` flex chain
  is preserved; scroll mode is byte-for-byte unchanged (additive).
- **`<div role="button">`, not `<button>`** — avoids invalid `<button><a>`
  nesting for the link-title lists; keyboard parity via onKeyDown.
- **Filters: reuse, don't rebuild.** The responsive FilterToolbar already
  bottom-sheets on mobile + shows chips; a parallel sheet would duplicate a
  platform primitive and trip `r14-no-page-searchbars`.
- **Non-clickable cards where no detail exists** (farm-tasks, parcels) — the
  no-horizontal-scroll win still lands; tap-through applies only where a
  detail route/modal exists (Tasks/Journal/Inventory).
