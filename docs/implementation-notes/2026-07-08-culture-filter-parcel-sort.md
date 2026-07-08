# 2026-07-08 — Per-culture filter + parcel sort (Location overview)

**Prompt:** #2 — user-confirmed reading: remove the **Farm Records tab** from
the Location detail page (the standalone Journal page + БАБХ PDF stay), and on
the **Overview tab** add a crop-type filter and default-sort parcels by size
descending.

## Design

- **Farm Records tab removed.** The Location detail tab bar drops from
  `overview | map | operations | records` to `overview | map | operations`.
  The register was redundant with the standalone `/journal` page. The **ДНЕВНИК
  (PDF) generate button + modal are kept** — the БАБХ diary export is still
  reachable from the location header, and the `farm-records` API + register
  backend are untouched (only the per-location tab UI is gone). The now-dead
  `recordColumns` / `downloadRecord` helpers (only the tab used them) were
  removed, and the `recordsQ` fetch is now gated on the generate modal alone.
- **Overview crop filter.** A `ToggleGroup` of crop chips (All + one per crop
  present) appears above the parcels list, shown only when the location grows
  more than one crop. Selecting a chip filters the parcels list; "All" clears.
- **Parcel sort.** The overview parcels list is sorted by `areaHa` descending
  by default (largest fields first), name as tiebreak — matching the same
  largest-first convention used by the crop-plan (#9) and map-icon (#1) work.

## Files

| File | Role |
| --- | --- |
| `src/app/.../locations/[locationId]/page.tsx` | Drop records tab; `cropFilter` state + `overviewParcels` (sorted+filtered) memo; crop-chip `ToggleGroup`; remove dead register helpers |
| `messages/en.json` · `messages/bg.json` | `cropFilterLabel` / `cropFilterAll` (EN + BG) |
| `tests/e2e/ag-farm-record.spec.ts` | UI assertion retargeted from the removed `?tab=records` to the kept `#dnevnik-pdf-btn` |

## Decisions

- **Removed only the tab, not the diary.** Per the user's clarification, the
  register/PDF is valuable (БАБХ compliance) — only the redundant per-location
  *tab* goes; the generate button, the API, and the `/journal` page remain.
- **`ToggleGroup` chips, not a `FilterToolbar`.** The overview isn't a
  `DataTable` list page; a lightweight chip toggle fits the single crop
  dimension without a full filter provider.
- **Sort in a memo, not a sortable column.** Size-desc is the *default* order
  the prompt asks for; a pre-sorted data array is the simplest way to express
  it and coexists with the crop filter.
