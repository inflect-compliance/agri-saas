# 2026-07-14 — Cadastre vector parcels overlay

**Commit:** `<sha> feat(cadastre): vector КККР parcels overlay (free default)`

## Design

The earlier raster cadastre overlay (PRs #288/#292) is retained but renders
nothing today (no working raster source — it's reserved for the paid №8002 WMS).
This adds the FREE default that actually renders: a **vector** parcels overlay
backed by a different, working public host —
`spp.api.bg/arcgis/rest/services/Public/CadBaseMap/MapServer/2` ("Имоти
(кадастър)"), an ArcGIS FeatureServer-style layer with national coverage whose
`/query` returns GeoJSON polygons reprojected server-side to EPSG:4326.

```
client (MapCanvas)                same-origin proxy               upstream (server-only)
  toggle on + zoom≥15  ──GET /cadastre/parcels?bbox=w,s,e,n──▶  ArcGIS /query (esriGeometryEnvelope,
  onLoad/onMoveEnd (debounced)          │ auth gate                f=geojson, outSR=4326, cap 3000)
  GeoJSON source + amber line layer  ◀──┘ bbox validate + Bulgaria
  (under own-parcel fills)               envelope + span cap + Redis cache (1d)
```

The upstream URL (`CADASTRE_PARCELS_URL`) is SERVER-ONLY — the client sees only
a `configured` boolean (`/cadastre/parcels/config`) + the same-origin endpoint.

## Files

| File | Role |
| --- | --- |
| `src/env.ts` | `CADASTRE_PARCELS_URL` (optional, server-only) + runtimeEnv wiring |
| `deploy/env.prod.example` | commented example key (parity) |
| `src/lib/geo/cadastre-parcels.ts` | pure helpers — bbox parse/validate, Bulgaria envelope, span cap, cache key, `/query` URL builder, property trimming |
| `src/lib/geo/cadastre-source.ts` | `resolveCadastreParcelsUrl` / `isCadastreParcelsConfigured` |
| `src/app/api/t/[tenantSlug]/cadastre/parcels/route.ts` | bounded same-origin proxy (GET, bbox → GeoJSON) |
| `src/app/api/t/[tenantSlug]/cadastre/parcels/config/route.ts` | `{ configured }` probe |
| `src/components/ui/map/MapCanvas.tsx` | `cadastreParcels` prop — viewport-bbox fetch, GeoJSON source + line layer |
| `src/app/t/[tenantSlug]/(app)/locations/[locationId]/page.tsx` | unified single toggle (prefers vector); passes `cadastreParcels` |

## Decisions

- **Bounds-abuse caps.** bbox must intersect Bulgaria (lon 22–29, lat 41–44.5)
  and both spans must be ≤ 0.2° (~15–22 km); malformed bbox → 400, out-of-bounds
  / oversized → empty FeatureCollection (200). The client also gates fetching at
  zoom ≥ 15 (`CADASTRE_PARCELS_MIN_ZOOM`) so a region-wide view never requests.
- **Graceful degrade.** Unconfigured / upstream error / timeout (8 s
  AbortController) all return an empty FeatureCollection (200) so the map stays
  usable — the overlay just shows nothing.
- **ONE toggle, vector preferred.** The location page shows a single cadastre
  toggle when EITHER source is configured; it drives the vector overlay when
  `CADASTRE_PARCELS_URL` is set (label „Кадастрални граници"), else the raster
  WMS path (label „Кадастрална карта"). Never two cadastre toggles. Online-only
  (disabled + hinted offline) — the overlay is not part of the offline pack.
- **Layer order.** The vector line layer draws ABOVE the basemap/soil/index
  rasters but BELOW the tenant's own parcel fills, so own fields stay prominent.
- **Redis cache** keyed by the bbox rounded to 3 decimals (~100 m) so nearby
  pans collapse onto one cached extent; 1-day TTL (boundaries are stable).
- **Property trim.** Features are trimmed to `{ upi, ekatte, nusetype }` —
  dropping every other upstream attribute (privacy + payload weight). No
  click-through / GetFeatureInfo this phase (the `upi` is carried for a
  possible follow-up).
