# 2026-06-17 — perf-scale: fast large operations (50+ fields, 100k+ lots)

**Branch:** `feat/perf-scale`. Four independent performance layers around the
spatial + inventory hot paths.

## Design

```
 Indexes        Parcel(tenantId,locationId,deletedAt) · InventoryLot(tenantId,createdAt)
                · StockTransaction(tenantId,lotId,createdAt)  (GiST on geometry already present)
 Geometry       ST_Simplify on the GeoJSON export path (?simplify=) + an MVT vector-tile
                endpoint /locations/:id/tiles/{z}/{x}/{y}.pbf; map uses vector tiles
                (read-only, zoom≥6), GeoJSON for sketch/select.  All ST_* stays in geo.ts.
 Caching        Redis list-cache (existing primitive) extended to CropType/CropVariety/Unit
                (1d) + WeatherObservation/GDD (6h); SWR revalidateOnFocus:false on /units.
 Pagination     lotLedger → cursor-paginated /ledger endpoint; traceLot N+1 locked (already BFS-batched).
```

### Geometry + tiles

`geo.ts` gains two fragments (the only new `ST_*`): `simplifiedGeoJsonSql`
(`ST_AsGeoJSON(ST_Simplify(col, tol))`) and `mvtTileSql` (`ST_AsMVT` over
`ST_AsMVTGeom(ST_Transform(geom,3857), ST_TileEnvelope(z,x,y))`, layer
`parcels`). `ParcelRepository.mvtForTile` returns the `bytea` as a Node
`Buffer` (PrismaPg adapter mapping); the `.pbf` route streams it with
`application/vnd.mapbox-vector-tile` (204 on an empty tile). The geo-raw-sql
containment guardrail still passes — the route + repo carry no raw `ST_`.

`MapCanvas` gains an optional `vectorTileUrl`; when set AND read-only AND
not drawing, it renders a `type:vector` source (minzoom 6) and caps the
GeoJSON layers at maxzoom 6 (no double-draw). Interactive select + sketch
are untouched (vector tiles carry no selected/done state, so selection
stays on GeoJSON). The location-detail map is interactive, so it passes the
prop but the gate no-ops it — the prop is wired + ready for a read-only
farm-overview view.

### Caching

The repo already had `src/lib/cache/list-cache.ts` (`cachedListRead` +
per-(entity,tenant) version-key invalidation). Extended the
`CacheableEntity` union and wrapped the four reads; writes
(`createCropType`/`createCropVariety`/`runWeatherPull`) bump the version.
`Unit` is global (no write path) → TTL-only; its cache key still carries
`tenantId` (a harmless per-tenant duplication of the same global list).

### Pagination + N+1

`traceLot` was **already** batched BFS (one `LotLink` query per genealogy
level, frontier in an `{ in: [...] }`). No N+1 to remove — locked instead
with `tests/unit/inventory-trace-batching.test.ts` (mocks the repo, asserts
one call per level with the whole frontier, even for a wide level).
`lotLedger` gains an additive cursor-paginated companion: `lotLedgerPage`
+ `listLotLedger` + `GET …/lots/:id/ledger?limit=&cursor=`. `getLot`'s
inline first-page ledger is unchanged (zero contract break).

## Files

| File | Role |
|---|---|
| `src/lib/db/geo.ts` | `simplifiedGeoJsonSql` + `mvtTileSql` |
| `src/app-layer/repositories/ParcelRepository.ts` | `mvtForTile`; `listForLocation` simplify opt |
| `src/app-layer/repositories/InventoryRepository.ts` | `lotLedgerPage` (cursor) |
| `src/app-layer/usecases/location.ts` / `inventory.ts` | `getLocationParcelTile` / `listLotLedger` |
| `…/locations/[id]/tiles/[z]/[x]/[y]/route.ts` | MVT `.pbf` endpoint |
| `…/inventory/lots/[lotId]/ledger/route.ts` | cursor-paginated ledger |
| `prisma/schema/{agriculture,inventory}.prisma` + migration | 3 composite indexes |
| `src/lib/rate-limit/apiReadRateLimit.ts` | exclude `.pbf` tiles from the read tier |
| `src/lib/cache/list-cache.ts` + 4 usecases + weather-pull | catalog/weather caching |
| `src/components/ui/map/MapCanvas.tsx` + location page | vector-tile source |
| `scripts/perf/*` + `docs/perf/parcel-list-benchmark.md` | pgbench harness + analysis |

## Decisions

- **`InventoryLot(cropPlanId, parentLotId)` doesn't exist.** Those columns
  aren't on the model — genealogy lives in `LotLink(parentLotId, childLotId)`,
  already indexed both ways. Reconciled to the real 100k-scale need: an
  `InventoryLot(tenantId, createdAt)` index for the cursor lot-list and a
  `StockTransaction(tenantId, lotId, createdAt)` index for the cursor ledger
  (plus the `Parcel(tenantId, locationId, deletedAt)` the prompt named).
- **`.pbf` excluded from the read rate limit.** Map pan/zoom fires tile
  bursts; 120/min would tear holes in the map. Tiles are still auth'd +
  tenant-scoped (the middleware gate runs first) and edge/browser-cacheable.
- **Benchmark is a harness + plan analysis, not fabricated numbers.** No DB
  in the build sandbox, so `scripts/perf/parcel-list-bench.sh` is a
  reproducible before/after (seed 5k → pgbench with the index → drop → run →
  restore), and the doc reasons about the EXPLAIN plan shape (deletedAt moves
  from heap-recheck into the index) + the geometry-serialisation tax that
  `?simplify` and vector tiles attack. Fill measured latencies from a staging
  run.
- **Migration hand-authored** (3 `CREATE INDEX IF NOT EXISTS`, names matching
  Prisma's convention, GiST left in place) — no RLS/table changes, so no
  `migrate dev` drift to strip.
