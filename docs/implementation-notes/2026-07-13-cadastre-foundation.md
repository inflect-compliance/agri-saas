# 2026-07-13 — Cadastre foundation (Bulgarian КАИС, Phase 1)

**Commit:** `<sha> feat(cadastre): EPSG:7801/32635 ingest + cadastral identity + КАИС surfacing`

## Design

Phase 1 of the КАИС cadastre integration — no external API calls, no new env
vars. Four seams:

1. **Reprojecting ingest.** Real КВС / КККР shapefile exports are EPSG:7801
   (BGS2005 / CCS2005 Lambert) or EPSG:32635 (UTM 35N) — projected METRES, not
   WGS84 degrees. `parseShapefileZip` reads the `.prj` itself (JSZip),
   `detectSridFromPrj` resolves the source SRID (EPSG authority code, then
   CRS-name/UTM signatures). When it recognises a supported CRS it STRIPS the
   `.prj` so shpjs yields raw metres, and stamps `ParseResult.srid`. The repo
   reprojects on write via a new geo fragment
   `reprojectedGeometrySql(geom, srid)` =
   `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(ST_SetSRID(
   ST_GeomFromGeoJSON(json), srid), 4326)), 3))` — **reproject first, repair
   second**. `areaHa` is computed from the SAME reprojected expression, so the
   geometry↔areaHa invariant holds. A prj-less file whose bbox sits in the
   Bulgarian metre band defaults to 7801 (the official cadastre CRS); anything
   else keeps the clear WGS84-range rejection.

2. **Cadastral identity.** `Parcel.cadastralId` (`EKATTE.masiv.parcel`, e.g.
   `68134.8360.729`) + `Parcel.ekatte` (5-digit prefix, leading zeros
   significant) + `@@index([tenantId, ekatte])`. `parseCadastralIdentity` reads
   an explicit id column, then any full-id string value, then composes from
   EKATTE+masiv+parcel components — validating `^\d{5}\.\d+(\.\d+)+$`
   throughout. The migration backfills existing rows from `propertiesJson`/`name`.

3. **Surfacing.** `ParcelCadastralInfo` (shared: parcel table cell + mobile
   card + ParcelDetailSheet) renders the identifier as a new-tab КАИС deep link
   (`https://kais.cadastre.bg/bg/Map`), plus a subtle warning badge when the
   documentary area diverges >5% from the mapped area.

4. **Area reconciliation groundwork.** The documentary area (площ по документ)
   is normalized into `propertiesJson._cadastreDocAreaDca` (decares) at import.
   dca stays DISPLAY-ONLY (#236); the badge compares it to `haToDca(areaHa)`.

### shpjs finding (for Phase 2)

shpjs 6.2.0's output FeatureCollection is `{ type, features, fileName }` —
it does **NOT** expose the source CRS / `.prj`. When a `.prj` is present and
proj4-parseable, shpjs already reprojects to WGS84 internally (`trans.inverse`);
when it is absent, coordinates stay in source metres. So the only way to know
the source CRS is to read the `.prj` ourselves — which is what this phase does.

## Files

| File | Role |
|------|------|
| `src/lib/spatial/parse.ts` | `.prj` read/strip, `detectSridFromPrj`, `parseCadastralIdentity`, `pickDocumentaryAreaDca`, `ParseResult.srid` |
| `src/lib/db/geo.ts` | `reprojectedGeometrySql` (ST_Transform-before-MakeValid) |
| `src/lib/agriculture/cadastre.ts` | client-safe constants + `documentaryAreaDca` + `areaDivergesFromDocument` |
| `src/app-layer/repositories/ParcelRepository.ts` | thread `sourceSrid`; write + read `cadastralId`/`ekatte` |
| `src/app-layer/jobs/spatial-import.ts` | pass `parsed.srid` through |
| `prisma/schema/agriculture.prisma` + migration | `cadastralId`, `ekatte`, `@@index([tenantId, ekatte])`, backfill |
| `src/components/ui/map/ParcelCadastralInfo.tsx` | shared КАИС link + mismatch badge |
| `src/components/ui/map/ParcelDetailSheet.tsx`, `locations/[locationId]/page.tsx` | wire the surface |
| `tests/helpers/shapefile-fixture.ts` + `tests/fixtures/cadastre-7801-parcel.zip` | 7801 fixture |

## Decisions

- **Strip the `.prj` when we recognise the CRS** rather than trust shpjs+proj4.
  Makes PostGIS the single authoritative reprojector — deterministic and
  independent of proj4's WKT handling for the Bulgarian Lambert CRS. (No `proj4`
  dependency added; PostGIS `ST_Transform` does the math.)
- **7801 default only for prj-less Bulgarian-band metres.** 7801 and 32635 are
  near-indistinguishable by coordinate magnitude over Bulgaria (7801's false
  northing was designed to mirror UTM), so 32635 requires a `.prj` to be
  recognised. Documented limitation; genuinely-unknown CRS still rejects.
- **EKATTE stays a string.** Leading zeros are significant; a numeric EKATTE
  that already lost them is never trusted for composition.
- **Requires PostGIS SRID 7801 in `spatial_ref_sys`** (PostGIS 3.1+ / PROJ 7+).
  `ST_Transform` throws if absent — an operator concern, not code.
