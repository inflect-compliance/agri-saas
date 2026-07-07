# 2026-07-07 — Soil Integration (#37)

**Commit:** `feat/soil`

## Design

Give every parcel a modelled soil profile from open data (ISRIC SoilGrids
2.0, CC-BY 4.0), colour the location map by soil class, and feed soil into
crop planning with an advisory crop-suitability flag.

```
Parcel create / geometry edit / spatial-import
        │  enqueueParcelSoilFetch (best-effort, non-blocking)
        ▼
  soil-fetch job  ── dedicated BullMQ queue (inflect-soil)
        │             Worker limiter 5/min  (SoilGrids fair-use)
        ▼
  fetchAndStoreParcelSoil(ctx, parcelId)
        │  centroid (geo.ts ST_Centroid) → 100 m grid cell (latE3/lonE3)
        │  ── SoilSample cache HIT → reuse ────────────────┐
        │  ── MISS → SoilGrids REST (or SOIL_BASE_URL mirror)
        │            → SoilSample.upsert (global cache)     │
        ▼                                                   │
  Parcel.soilType + Parcel.soilJson  ◄──────────────────────┘
        │  logEvent(SOIL_FETCHED)
        ▼
  Location map "Soil view" (MapCanvas soilMode) + legend + profile card
  Crop planning: per-planting suitability badge (good/caution/poor/unknown)
```

Soil is framed everywhere as a MODELLED ESTIMATE with uncertainty, never a
lab result. Suitability is advisory-only and catalog-driven — it yields
`unknown` (never a fabricated verdict) when the variety carries no curated
preferences or the parcel has no soil.

## Files

| File | Role |
|------|------|
| `prisma/schema/agriculture.prisma` | `Parcel.soilType`/`soilJson`; global `SoilSample` cache (no tenantId) |
| `prisma/schema/planning.prisma` | `CropVariety.soilDefaultsJson` (curated pH / texture / drainage prefs) |
| `prisma/migrations/20260707120000_soil_integration/` | additive migration (2 cols + 1 col + cache table) |
| `src/lib/db/geo.ts` | `centroidLonLatSql` — `ST_X/ST_Y(ST_Centroid())` (containment) |
| `src/lib/soil/texture.ts` | USDA texture triangle (pure) + drainage tendency |
| `src/lib/soil/suitability.ts` | advisory suitability engine (pure, catalog-driven) |
| `src/lib/soil/soilgrids-client.ts` | SoilGrids REST client + unit-conversion normaliser (pure HTTP) |
| `src/lib/soil/types.ts` | `SoilProfile`, colour-blind-safe palette, label helper |
| `src/app-layer/usecases/soil.ts` | fetch/cache/persist + enqueue helper + planting suitability |
| `src/app-layer/jobs/soil-fetch.ts` | batch soil-fetch job |
| `src/app-layer/jobs/queue.ts` + `types.ts` + `scripts/worker.ts` | dedicated soil queue + 5/min worker |
| `src/components/soil/*` | `SoilLegend`, `SoilProfileCard`, `SoilSuitabilityBadge` |
| `src/components/ui/map/MapCanvas.tsx` | `soilMode` fill + pending outline |
| location `page.tsx` / `ParcelDetailSheet.tsx` | soil toggle + legend + profile |
| planning `PlantingBoard.tsx` + `plantings/[id]/soil/route.ts` | per-field suitability |
| `THIRD_PARTY_NOTICES.md` | SoilGrids CC-BY attribution |

## Decisions

- **`SoilSample` is a GLOBAL catalog table (no `tenantId`)** — soil data isn't
  tenant-owned, and a shared cache is what keeps us inside SoilGrids' ~5 req/min
  fair-use budget. Like `Unit`, it's absent from `TENANT_SCOPED_MODELS`, so
  rls-coverage requires no RLS for it (verified: guard stays green).
- **Grid key = integer milli-degrees (`latE3`/`lonE3`, 3 dp ≈ 100 m)** — an
  exact, index-friendly equality key with no Decimal-precision snags; nearby
  parcels share a cell and never trigger a second provider call.
- **Dedicated `inflect-soil` queue with a Worker-level `limiter: {max:5,
  duration:60000}`** — BullMQ's limiter is per-worker, so a separate queue is
  the clean way to rate-limit only soil calls without throttling other jobs.
  The cache absorbs the majority of would-be calls anyway.
- **`SOIL_BASE_URL` IS the fallback path** — pointing it at a self-hosted
  SoilGrids/OpenLandMap mirror (same query shape) is the documented escape
  when the beta public REST API is throttled/down; retries (5×, 30 s backoff)
  cover transient outages, and the parcel just stays "soil pending" meanwhile.
- **Suitability thresholds live in `CropVariety.soilDefaultsJson`, never
  fabricated** — no defaults ⇒ `unknown`. This keeps the "never invent
  agronomic numbers" rule intact; the USDA triangle boundaries are geometric
  definitions, not agronomic thresholds, so hard-coding them is fine.
- **Trigger enqueues are best-effort + post-commit** — a Redis hiccup can
  never block or fail a parcel write (graceful degradation).
- **`replaceForLocation` now returns created IDs** (was a count) so the import
  job can enqueue soil for exactly the new parcels; the only caller was updated.
