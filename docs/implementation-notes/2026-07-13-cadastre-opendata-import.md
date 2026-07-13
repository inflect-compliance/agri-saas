# 2026-07-13 — Cadastre: projected-CRS probe (Part A) + КАИС OpenData import (Part B)

**Commit:** `<sha>` feat(cadastre): projected-CRS probe + КАИС OpenData import by identifier

Builds on the Phase 1 foundation (#287: EPSG:7801 ingest, cadastral identity,
area reconciliation). Two parts, one PR.

## Part A — accept prj-less КС2005 / UTM shapefiles

Phase 1 handled a shapefile whose `.prj` resolves the CRS. Cadastre archive
exports frequently ship WITHOUT a `.prj`, and 7801 (КС2005/BGS2005 Lambert) and
32635 (UTM 35N) are **indistinguishable by raw metre magnitude** over Bulgaria.

- `parse.ts`: when bounds fail the WGS84 range check AND fall in the Bulgarian
  projected-metre band (x∈[80k,1M], y∈[4.4M,5.1M]), the parser no longer guesses
  7801 — it leaves `srid` undefined and stamps `ParseResult.sourceCrs =
  'projected-candidate'`. Anything outside the band still throws (message now
  mentions КС2005). Pure module, no DB.
- `geo.ts`: `probeCandidateSridSql(geometries, srids)` — ONE round-trip that
  `ST_Transform`s a sample of the geometries from each candidate SRID to 4326 and
  returns each candidate's transformed bounds. `reprojectedRepairedGeometrySql`
  is the named write-path entry (delegates to Phase 1's `reprojectedGeometrySql`:
  `ST_Transform(ST_SetSRID(geom, srid), 4326)` innermost, then repair).
- `ParcelRepository.probeSourceSrid` disambiguates by **transformed position**:
  the candidate whose bounds land inside Bulgaria's WGS84 envelope
  (`BULGARIA_WGS84_ENVELOPE` = lon 22–29, lat 41–44.5) wins. Exactly one match →
  use it; zero or both → `null` (the job rejects with an actionable error).
- `spatial-import` job runs the probe when `sourceCrs === 'projected-candidate'`.
  Topology validation still runs on RAW geometries (SRID-independent).
- Migration `20260713170000_cadastre_opendata_import` idempotently inserts
  EPSG:7801 into `spatial_ref_sys` (`ON CONFLICT DO NOTHING`) for self-hosted
  PostGIS builds that omit the national grids.

**Disambiguation limit (documented, by design).** A prj-less parcel in
*central* Bulgaria (near lon 25.5 / lat 42.7) transforms inside the envelope
under BOTH candidates — validated with proj4:

| source pt (WGS84) | in 7801 → 4326 | in 32635 → 4326 | unique? |
|---|---|---|---|
| 28.30, 43.50 (E) | 28.30, 43.50 ✓ | 29.80, 43.52 ✗ | **7801** |
| 23.00, 42.00 (W) | 21.50, 41.98 ✗ | 23.00, 42.00 ✓ | **32635** |
| 25.50, 42.70 (C) | 25.50, 42.70 ✓ | 27.00, 42.72 ✓ | ambiguous → reject |

So a central-Bulgaria prj-less upload is rejected with "include a .prj". This is
correct: a raw-magnitude guess there would be a coin-flip. Edge / near-border
parcels (the common case for a single field) disambiguate cleanly.

## Part B — import parcels from КАИС OpenData by identifier

Identifiers are `ЕКАТТЕ.масив.номер` (e.g. `68134.8360.729`); the 5-digit ЕКАТТЕ
prefix selects the settlement archive.

### VERIFIED КАИС OpenData wire protocol (from the production VM, 2026-07-13)

The portal (kais.cadastre.bg) is a Kendo UI FileManager over an
anti-forgery-protected directory API. The **drill-down key is `target`** (a
plain `path=` field is ignored — the open item Phase-1 discovery left).

1. `GET /bg/OpenData` (HTML) → capture the anti-forgery **Set-Cookie** AND the
   hidden `__RequestVerificationToken` (len ~155). Both required on every POST.
2. `POST /bg/OpenData/Read` — form `target=<parentPath>` +
   `__RequestVerificationToken=<tok>`, header `RequestVerificationToken: <tok>`,
   cookie. `target=""` → the 28 oblasti. Response: JSON array of
   `{Name, Path, Extension, IsDirectory, HasDirectories, Size, ModifiedUtc, …}`.
   Path separator `/`. Tree depth:
   `oblast → община → settlement "гр./с. <name> (<ЕКАТТЕ>)" → files`. The
   settlement folder name embeds the 5-digit ЕКАТТЕ in parentheses.
3. `GET /bg/OpenData/Download?path=<url-encoded Path>` → the ZIP (application/zip,
   verified a real 3.3 MB archive).

Files per settlement: **`поземлени имоти.zip`** (land parcels — the ONLY one we
fetch), `сгради.zip` (buildings), `самостоятелни обекти.zip` (SOS), and
`собственост *.zip` (ownership registers — **personal data, never fetched**).

**Refresh cadence:** archives are regenerated per-oblast on a rolling ~2–4 week
cycle; each entry's `ModifiedUtc` is the authoritative freshness stamp. ЕКАТТЕ →
oblast/община has no arithmetic mapping, so resolving an ЕКАТТЕ needs a pruned
DFS over the tree (`HasDirectories:false` prunes leaves) — the resolved archive
is cached per ЕКАТТЕ so the walk happens once.

### Implementation

- `src/lib/cadastre/opendata-client.ts` — pure HTTP (AbortController timeout,
  throw on non-2xx, `baseUrl` + injected `fetchImpl` for tests). `fetchIndex()`,
  `fetchArchive(ekatte)` (DFS + size cap + walk-budget). Downloads ONLY
  `поземлени имоти.zip`; refuses ownership registers.
- `src/lib/cadastre/identifier.ts` — strict `^\d{5}\.\d+\.\d+$` validator +
  normalizer (leading zeros preserved) + `parseIdentifierList` + `groupByEkatte`.
- `src/lib/cadastre/privacy.ts` — `stripOwnerAttributes` drops owner-ish keys
  (Cyrillic + transliterated) from every feature's properties before persist.
  Strong fragments match as substring; short tokens (`име`, `лице`, …) match
  whole tokens only so a land-use `НАИМЕНОВАНИЕ` survives.
- `cadastre-import` BullMQ job — groups by ЕКАТТЕ → cache-first archive resolve
  (global `CadastreArchive` row + storage ZIP, 14-day TTL) → `parseShapefileZip`
  → select features whose `cadastralId` was requested → strip owner attrs →
  `addParcelsForLocation` (КС2005 reprojection, `.prj`-SRID preferred, probe
  fallback) → report `notFound`.
- `CadastreArchive` model — GLOBAL (no tenantId, like `SoilSample`): the archive
  is public data shared across tenants, so the ZIP is cached under a global
  storage key (not a tenant-scoped `FileRecord`).
- UI — second tab „От кадастъра" in `SpatialImportModal`, gated on a
  server-computed boolean (`GET .../cadastre-import` → `{ enabled }`); the КАИС
  URL is never exposed client-side. Env `CADASTRE_OPENDATA_INDEX_URL` (optional,
  server-only; feature hidden when unset — SOIL_BASE_URL pattern).

## Files

| File | Role |
|---|---|
| `src/lib/spatial/parse.ts` | `sourceCrs: 'projected-candidate'` flag + band predicate |
| `src/lib/db/geo.ts` | `probeCandidateSridSql` + `reprojectedRepairedGeometrySql` |
| `src/app-layer/repositories/ParcelRepository.ts` | `probeSourceSrid` + Bulgaria envelope |
| `src/app-layer/jobs/spatial-import.ts` | probe wiring for prj-less imports |
| `src/app-layer/jobs/cadastre-import.ts` | КАИС import job |
| `src/lib/cadastre/{opendata-client,identifier,privacy}.ts` | client + validator + strip |
| `src/app-layer/usecases/cadastre-import.ts` | staging usecase + feature flag |
| `src/app/api/t/[tenantSlug]/locations/[id]/cadastre-import/**` | POST enqueue + GET enabled + GET poll |
| `src/components/ui/map/SpatialImportModal.tsx` | two-tab import modal |
| `prisma/schema/agriculture.prisma` | `CadastreArchive` model |
| `prisma/migrations/20260713170000_cadastre_opendata_import/` | spatial_ref_sys 7801 + CadastreArchive |

## Decisions

- **Probe by transformed position, not magnitude.** 7801 and 32635 overlap in
  metre magnitude over Bulgaria; only the reprojected position discriminates,
  and even that is ambiguous in central Bulgaria (rejected, not guessed).
- **`CadastreArchive` is global.** The land-parcels ZIP is identical for every
  tenant — a tenant-scoped `FileRecord` would defeat cross-tenant cache reuse and
  force re-downloads. Stored under a plain `cadastre-opendata/<ekatte>/…` key.
- **Fetch land-parcels only.** The client hard-refuses ownership registers and a
  defence-in-depth strip runs over every feature — CC-licensed OpenData is not a
  GDPR waiver.
- **`.prj` SRID preferred over probe** in the cadastre job — КАИС ships КС2005
  with a `.prj`, so the probe is only the prj-less fallback (avoids the
  central-Bulgaria ambiguity for the normal case).
