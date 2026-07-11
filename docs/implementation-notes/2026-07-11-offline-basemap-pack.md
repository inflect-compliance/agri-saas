# 2026-07-11 — Per-location offline basemap pack (Roadmap-6 P1b)

**Commit:** `<sha> feat(offline): per-location offline basemap pack`

## Design

The operator orientation map (`MapCanvas`) blanks at zero bars: every basemap
source it uses — MapTiler satellite, the remote demotiles style, GEE index
rasters, the ISRIC WMS — is CROSS-ORIGIN, and the service worker
(`public/sw.js`) deliberately passes cross-origin requests straight through
(`url.origin !== self.location.origin → return`). So with no signal the
parcels can render (same-origin, cached) but the backdrop is a void.

This adds a bounded, USER-INITIATED offline basemap pack for a single
location:

```
Location detail (Map tab)
  └─ "Download offline map" (DownloadBasemapButton)
        │  tilesForBbox(location.bounds)  → small tile list (z0–6)
        ▼
  GET /api/t/<slug>/locations/<id>/basemap/{z}/{x}/{y}   (same-origin proxy)
        │  validates z-range + bbox, proxies demotiles pbf
        ▼
  service worker  isBasemapRequest → cacheFirstBasemap
        │  stores in BASEMAP_CACHE (dedicated, LRU + byte budget)
        ▼
  offline: MapCanvas swaps mapStyle → buildOfflineBasemapStyle(same-origin)
           → SW serves the cached tiles → map renders (parcels + backdrop)
```

### Source + licensing (the load-bearing choice)

The pack is sourced from the **MapLibre demotiles** vector tiles
(`demotiles.maplibre.org`) — **Natural Earth data, public domain** — the SAME
source the app already renders as its keyless fallback basemap
(`resolveBasemapStyle`). We deliberately do **NOT** cache live MapTiler tiles:
MapTiler's licence for a wholesale/bulk offline copy is unclear, so a bounded
user-initiated download of its imagery would be a licensing risk. Natural-earth
demotiles are unambiguously redistributable. The honest tradeoff: offline the
map degrades to a coarse (country / coastline / graticule) backdrop rather than
satellite imagery — but the operator's own parcels render on top at full
fidelity (from the same-origin field-data cache), so offline the map shows
fields on a real backdrop instead of a blank void. The rationale is duplicated
in `src/lib/offline/basemap-pack.ts` and the proxy route so a future engineer
doesn't "optimise" it into a MapTiler cache.

### Bounding

- **Zoom**: capped at demotiles' native `[0, 6]`; MapLibre overzooms for
  closer views, so the pack is a handful of tiles even for a whole field.
- **Extent**: the proxy rejects (404) any tile outside the location's bbox, so
  the endpoint can never fan out into an unbounded crawl of the upstream.
- **Count**: `BASEMAP_PACK_MAX_TILES = 256` safety ceiling (a real farm bbox
  is nowhere near it).

### Dedicated SW cache + LRU

`BASEMAP_CACHE` is SEPARATE from the field-data `DATA_CACHE` (owned by another
PR — this change does not touch `isFieldDataRequest`). It is cache-first
(immutable natural-earth geometry) with a 24 MB byte budget and LRU eviction:
Cache Storage preserves insertion order, `cacheFirstBasemap` moves a touched
tile to the newest end on every hit, and `evictBasemapOverBudget` sheds the
oldest tiles when over budget. The eviction predicate is extracted, pure, and
unit-tested (`selectBasemapEvictions`); the SW mirrors it inline (it can't
import from `src/`), kept in lockstep by the offline-pwa-coverage guardrail.

### Offline style swap

`MapCanvas` gains an optional `offlineBasemapTileUrl` prop + `navigator.onLine`
tracking. When offline AND the prop is set, it swaps `mapStyle` to
`buildOfflineBasemapStyle(...)` — a minimal, **glyph-free / sprite-free** style
(background + `countries` fill/line + `geolines` line, NO symbol layers) that
references ONLY the same-origin pack tiles, so nothing cross-origin is fetched
with no signal. Online, or when the prop is absent, behaviour is exactly as
before.

## Files

| File | Role |
|------|------|
| `src/lib/offline/basemap-pack.ts` | Shared tile math (`tilesForBbox`, `isTileInBbox`, `lngLatToTileXY`) + constants + the pure `selectBasemapEvictions` LRU predicate + licensing rationale |
| `src/lib/geo/offline-basemap-style.ts` | `buildOfflineBasemapStyle` — minimal glyph-free same-origin MapLibre style |
| `src/app/api/t/[tenantSlug]/locations/[id]/basemap/[z]/[x]/[y]/route.ts` | Same-origin, bbox-bounded demotiles proxy |
| `src/app-layer/usecases/location.ts` | `getLocationBounds` — light bbox lookup for the proxy's bound check |
| `public/sw.js` | `BASEMAP_CACHE`, `isBasemapRequest`, `cacheFirstBasemap`, mirrored LRU eviction, fetch wiring |
| `src/components/ui/map/DownloadBasemapButton.tsx` | "Download offline map" affordance (bounded, user-initiated fetch loop) |
| `src/components/ui/map/MapCanvas.tsx` | `offlineBasemapTileUrl` prop + online/offline style swap |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/page.tsx` | Wires the button + passes the offline tile template to MapCanvas |
| `messages/{en,bg}.json` | `offlineMap*` strings |
| `tests/unit/offline/basemap-pack.test.ts` | Unit tests for the LRU predicate + tile math |
| `tests/e2e/mobile/offline-basemap.spec.ts` | `@mobile` e2e: download → offline map renders (no blank void) |
| `tests/guardrails/offline-pwa-coverage.test.ts` | Pins the dedicated cache + LRU without weakening "never cache arbitrary /api" |

## Decisions

- **Vector demotiles, not raster.** No clearly-permissive raster basemap
  source exists for bulk caching (OSM raster policy forbids it; Esri/others
  need keys). Public-domain demotiles vector is the licence-clean choice and
  it's already the app's keyless fallback, so offline degrades to a look users
  already see.
- **Glyph-free offline style.** Rendering vector tiles offline normally needs
  same-origin glyphs + sprite too. Restricting the offline style to
  background/fill/line layers (no `symbol`) removes that requirement entirely —
  a much smaller surface than proxying a whole style bundle.
- **Cache-first, not network-first, for basemap.** Basemap tiles are immutable
  natural-earth geometry — a cached tile is always correct, so cache-first is
  instant and offline-capable. (Field data stays network-first — freshness
  matters there.)
- **Bound-check in the proxy, not just the client.** The client computes the
  tile list, but the server independently rejects out-of-bbox tiles so the
  endpoint isn't a general basemap proxy.
- **Separate cache, untouched field-data path.** The parcel/field-data caching
  is a separate open PR; this change adds an orthogonal cache and does not
  modify `isFieldDataRequest`/`DATA_CACHE`.
