# 2026-07-02 — Satellite vegetation-index overlays (NDRE / GNDVI / EVI)

**Commit:** `<pending> feat(map): NDRE + GNDVI + EVI overlays via Google Earth Engine`

## Design

Extends the map's satellite overlay from two indices (NDVI, NDWI) to five,
and in doing so replaces the copy-pasted per-index wiring with a
config-driven catalogue so a sixth index is one entry, not five edits.

```
src/lib/agro/vegetation-indices.ts   ← single source of truth (client-safe)
        │  VegetationIndex union + VEGETATION_INDICES[] (label, route slug,
        │  legend ramp, low/high captions)
        ├──────────────► locations page: buttons + legend .map() over it,
        │                one activeIndex state, one SWR query, one status line
        └──────────────► earth-engine.ts imports only the TYPE

src/lib/agro/earth-engine.ts (server-only)
        INDEX_SPECS[index] = { band(img), visParams }   ← band math + ramp
        getIndexTileUrl(index, aoi, win)                ← shared EE pipeline
        get{Ndvi,Ndwi,Ndre,Gndvi,Evi}TileUrl            ← thin named wrappers

src/lib/agro/index-tiles-handler.ts
        handleIndexTiles(index, getTileUrl, req, params) ← shared route body
        (getTenantCtx → bounds → Redis cache → getTileUrl → cache)

src/app/api/t/[tenantSlug]/agro/<index>-tiles/route.ts   ← 5 thin routes
```

The five indices are **mutually exclusive** on the map — only one overlay is
ever active — so `MapCanvas` collapsed its `showNdvi/ndviTileUrl` +
`showNdwi/ndwiTileUrl` prop quartet into a single
`indexOverlay?: { id, tileUrl } | null` that renders one raster
`<Source>`/`<Layer>` keyed by index id.

## Band math (Sentinel-2 SR, `COPERNICUS/S2_SR_HARMONIZED`)

| Index | Formula | Bands | EE call |
|---|---|---|---|
| NDVI | (NIR−Red)/(NIR+Red) | B8,B4 | normalizedDifference |
| NDWI | (Green−NIR)/(Green+NIR) | B3,B8 | normalizedDifference |
| NDRE | (NIR−RedEdge)/(NIR+RedEdge) | B8,B5 | normalizedDifference |
| GNDVI | (NIR−Green)/(NIR+Green) | B8,B3 | normalizedDifference |
| EVI | 2.5·((NIR−Red)/(NIR+6·Red−7.5·Blue+1)) | B8,B4,B2 | expression |

EVI is the odd one out: its additive `+1` needs true reflectance, so the
expression divides each band by the S2 10000 DN scale (the ratio indices are
scale-invariant and use raw DN). All share the same pipeline: <60% cloud
filter → SCL cloud/shadow/snow mask → per-image band math → 30-day median →
clip → `getMap`.

## Files

| File | Role |
|---|---|
| `src/lib/agro/vegetation-indices.ts` | NEW — client-safe index catalogue (type + UI specs) |
| `src/lib/agro/earth-engine.ts` | refactor to `INDEX_SPECS` + `getIndexTileUrl`; +3 wrappers |
| `src/lib/agro/index-tiles-handler.ts` | NEW — shared tile-route body |
| `src/app/api/t/[tenantSlug]/agro/{ndvi,ndwi}-tiles/route.ts` | slimmed to the handler |
| `src/app/api/t/[tenantSlug]/agro/{ndre,gndvi,evi}-tiles/route.ts` | NEW routes |
| `src/components/ui/map/MapCanvas.tsx` | `indexOverlay` prop replaces the NDVI/NDWI quartet |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/page.tsx` | config-driven toolbar + status |

## Decisions

- **Per-index named `get<Index>TileUrl` wrappers kept** even though they all
  delegate to `getIndexTileUrl`. The route unit tests mock a single named
  earth-engine export; keeping the wrappers preserves that mocking style and
  gives each route a stable import.
- **Shared handler takes the tile fn as an argument** rather than resolving
  it from the index string. That way each route file imports its own
  `get<Index>TileUrl`, so a test that mocks `@/lib/agro/earth-engine` still
  intercepts the call transitively through the handler.
- **Handler lives in `src/lib/agro/`** (shared infra), not the route dir.
  It imports `@/app-layer/context` + usecases; there's precedent
  (`src/lib/security/require-module.ts`) and no layering guard forbids it.
- **Legend ramps stay distinct per index** (RdYlGn / BrBG / PRGn / YlGn /
  viridis) so two legends never read the same. The CSS gradient literals
  live in the catalogue so Tailwind JIT still emits them.
- **Individual toggle buttons, not a segmented control.** The mobile e2e
  pins `role=button name="NDVI"` at ≥44px; a config-driven `.map()` of
  `<Button>`s keeps that contract while staying DRY.
- **Display window per index is a `getMap` correctness concern, not
  cosmetics** (fixed while adding the new indices). McFeeters NDWI is
  NEGATIVE over vegetated/soil fields (NIR ≫ Green), so the original
  `min: 0, max: 0.8` window clamped every land pixel to one colour — the
  overlay rendered a uniform brown block for every date while still
  "working" (a tile URL came back). Fixed to a symmetric `[−0.5, 0.5]`.
  The `min`/`max`/`palette`/band pair moved into a pure `index-recipes.ts`
  so two tests can guard rendering WITHOUT a live EE call:
  `tests/guards/vegetation-index-recipes.test.ts` ratchets that each
  display window contains its index's physical crop-value range (the
  buggy NDWI window failed the midpoint check), and
  `tests/unit/earth-engine-index.test.ts` mocks EE to assert
  `getIndexTileUrl` actually feeds each recipe's bands + window into
  `getMap` (NDWI's `min < 0`).
