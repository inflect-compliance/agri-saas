# 2026-06-27 — Spatial-import hardening (coord guard, skip count, cadastral naming)

**Commit:** `<sha> feat(spatial-import): coordinate guard + honest skip count + cadastral naming`

Three hardening fixes to the parcel-boundary importer, surfaced by testing
real-world Bulgarian cadastral shapefiles (`AGROREI_OOD_2026` — UTM Zone 35N,
Windows-1251 Cyrillic). The files themselves imported cleanly; these close
latent gaps the next file might hit.

## Design

### Fix 1 — coordinate-range guard
`shpjs` reprojects a shapefile to WGS84 using its `.prj`. When it *can't*
(unsupported/missing `.prj`), coordinates silently stay in the source CRS
(e.g. UTM metres — easting ~500000, northing ~4.7M) and used to be stored as
garbage lat/lon, or fail confusingly deep in PostGIS. `parseSpatialFile` now
checks the computed bounds and throws `SpatialParseError` if they fall outside
lon ±180 / lat ±90, with an actionable message ("re-export as WGS84 /
EPSG:4326"). The route already maps `SpatialParseError` → 4xx, so the user gets
a clear error instead of silent corruption.

### Fix 2 — honest `skipped` count
`normalizeToParcels` drops non-polygon features (points/lines); the result's
`skipped` was hardcoded to `0`, so a partial import looked complete.
`normalizeToParcels` (and the three format parsers) now return
`{ parcels, skipped }`; `parseSpatialFile` reports the real count. The job
already threaded `parsed.skipped` into its result — it was just always 0. The
count now surfaces to the user: the import modal passes it to `onImported`, and
the location page shows a toast ("Imported N parcels — M non-polygon features
skipped"). Previously the page showed nothing on import (silent refresh).

### Fix 3 — cadastral composite naming
Parcels were named from the bare `NAME` column → "3" / "19" (block numbers).
A new `CODE_KEYS` set (`EKATTE`, `CADASTRE`, `KVS`, `REGION`, `BLOCK`,
`ZONE`, …) prefixes a cadastral/area code when present: EKATTE 15655 + NAME 3
→ **"15655-3"**. Degrades gracefully — name-only → name, code-only → code,
neither → "Parcel N". The composition is Unicode-safe: a Cyrillic name is
preserved verbatim (e.g. "15655-Северно поле").

### Cyrillic
`shpjs` already honours the `.cpg` (verified: `АГРОРЕИ ООД` round-trips). The
new naming code is string-only / Unicode-safe and never assumes ASCII. A unit
test locks in that a Cyrillic `NAME` + `EKATTE` composes correctly and that
Cyrillic properties survive verbatim.

## Files

| File | Role |
| --- | --- |
| `src/lib/spatial/parse.ts` | Fix 1 (coord guard) + Fix 2 (`{parcels, skipped}` through the chain) + Fix 3 (`CODE_KEYS` / `pickValue` / composite `pickName`). |
| `src/components/ui/map/SpatialImportModal.tsx` | Threads `skipped` from the job result into `onImported`. |
| `locations/[locationId]/page.tsx` | Import-result toast (parcel count + skipped), via `useToast`. |
| `tests/unit/spatial-parse.test.ts` | Coord-guard, skip-count, composite + Cyrillic naming, boundary-coords, updated to the `{parcels, skipped}` API. |

## Decisions

- **Coord guard lives in `parseSpatialFile` (the pure parser)**, not the job —
  it's a coordinate concern, unit-testable, and reuses the existing
  `SpatialParseError` → 4xx mapping for a clean user message.
- **`{ parcels, skipped }` return shape** changed `normalizeToParcels` +
  the three format parsers. Only the unit tests consumed them directly;
  `parseSpatialFile`'s public `ParseResult` is unchanged, so the job/route are
  untouched.
- **`CODE_KEYS` is a small curated list**, not config — covers the cadastral
  exports we see (EKATTE-style) and degrades to the prior behaviour for every
  other file (no existing test or the seed carries a code key, so naming is
  unchanged for them). A configurable name-column mapping is the next step if
  more formats need it.
