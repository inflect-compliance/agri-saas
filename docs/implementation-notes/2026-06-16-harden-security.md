# 2026-06-16 — Harden security (AG RLS fuzz + spatial-upload abuse + supply-chain CI + SCIM isolation)

**Branch:** `feat/harden-security`

Goal: drift-proof tenant isolation, abuse-resistant spatial uploads,
supply-chain confidence on the agriculture surfaces. Four independent
remediations, one per the prompt's checklist.

## Design

### #1 — AG cross-tenant isolation fuzz tests

`tests/integration/ag-rls-isolation.test.ts` asserts RLS isolation
*behaviourally* (not just policy existence) across the agriculture graph:
`Location`, `Parcel`, `OperationParcel`, `InventoryLot`,
`StockTransaction`, `YieldRecord`, `Contract`. Two tenants are seeded;
every model is checked for SELECT isolation (A's context cannot
`findUnique` B's row), INSERT isolation (creating with B's tenantId from
A's context is rejected by RLS), DELETE isolation (A's `deleteMany`
leaves B intact), and the write-path verbs (`appendStockTransaction`,
`markOperationParcel`, `createParcel`) all fail closed across the tenant
boundary. A no-context probe under `app_user` returns zero rows for all
seven tables. Mirrors the established `rls-isolation.test.ts` harness.

### #2 — Spatial-upload abuse hardening

The parcel-import path (`importLocationSpatialFile`) accepted an
arbitrary operator upload and parsed it **synchronously on the request
thread** — a hostile 200 MB shapefile or a million-vertex polygon could
pin a CPU and balloon PostGIS cost. The new pipeline has four ordered
defence layers and moves the parse off-thread:

```
POST /locations/:id/spatial-import        (HTTP boundary — synchronous)
  ├─ per-format byte cap on file.size      → 413 BEFORE buffering
  │    shapefile 5 MB · GeoJSON/KML 10 MB   (assertUploadWithinSize)
  ├─ stageLocationSpatialImport(...)        (usecase — stage + enqueue)
  │    ├─ verify Location exists (tenant-scoped)
  │    ├─ storage.write(domain 'spatial') + FileRecord
  │    └─ enqueue('spatial-import', …)       → 202 { jobId }
  └─ 202 Accepted

worker: spatial-import job                  (off-thread — runLocationSpatialImport)
  ├─ stream staged bytes back from storage
  ├─ parseWithBudget(...)                    30 s wall-clock race
  ├─ assertParcelComplexity(parcels)         → 422 (count/vertex caps)
  └─ runInTenantContext:
       ├─ findInvalidGeometryNames(parcels)  batched ST_IsValid → 422 fail-closed
       ├─ replaceForLocation(...)            persist
       └─ logEvent(LOCATION_SPATIAL_IMPORTED)

GET /locations/:id/spatial-import/:jobId    poll → state / result / failedReason
```

The modal POSTs, then polls the per-job status route to completion (the
job's `failedReason` carries the precise per-format / complexity /
topology message).

The **byte cap is the real CPU bound** — parsing ≤10 MB of GeoJSON/KML is
sub-second, so the synchronous JS parse cannot run away. The 30 s
wall-clock budget is a backstop for the one genuinely-async path
(`shpjs` shapefile decompression); it cannot pre-empt a synchronous spin,
which is honestly documented in `parseWithBudget`.

The topology check (`ST_IsValid`) is batched into ONE query
(`invalidGeometryIndicesSql` over an unnested `VALUES` list) so a
bulk import never N+1s — and the whole import fails closed if *any*
parcel self-intersects (a bowtie would otherwise persist with a
meaningless `ST_Area`).

### #3 — Supply-chain CI + SBOM (Agent B)

`ci.yml` Security job gains two gates after `npm ci`: lockfile integrity
(`git diff --exit-code package-lock.json` — catches a stale lockfile
`npm ci` silently normalises) and registry signature verification
(`npm audit signatures` — proves npm published each tarball, a layer the
integrity-hash pin alone doesn't give). The existing
`--audit-level=moderate` blocker + Trivy `CRITICAL,HIGH` are untouched
(ratchet `security-gate-strictness.test.ts` still 4/4). `release.yml`
emits an SPDX-JSON SBOM via `anchore/sbom-action@v0.24.0` (pinned) and
attaches it to the GitHub Release, gated on an actual publish. The three
geo libs (`shpjs`, `@tmcw/togeojson`, `maplibre-gl`) are pinned
caret-free for reproducible spatial-parse builds.

### #4 — SCIM 2.0 tenant-isolation tests (Agent B)

`tests/integration/scim-isolation.test.ts` (18 tests) proves the SCIM
user/group usecases fail closed across tenants: list/fetch/modify of a
sibling tenant's user returns null/false; the role allow-list provisions
`READER` for `roles:[admin|owner]` (never escalates) while
`roles:[editor]→EDITOR` proves it isn't a blanket downgrade; revoked +
unknown + missing tokens all reject with `ScimAuthError`; group reads are
tenant-scoped. The user usecases run on the global (no-RLS) client, so
this suite is precisely the proof their explicit `tenantId` where-clauses
fail closed.

## Files

| File | Role |
|---|---|
| `tests/integration/ag-rls-isolation.test.ts` | **#1** — ag cross-tenant CRUD + write-path fuzz isolation |
| `src/lib/spatial/limits.ts` | **#2** — pure byte-cap + parcel-complexity guards (`SpatialLimitError` 413/422) |
| `src/lib/db/geo.ts` | **#2** — `invalidGeometryIndicesSql` (batched `ST_IsValid`, stays in geo.ts) |
| `src/app-layer/repositories/ParcelRepository.ts` | **#2** — `findInvalidGeometryNames` (one query, no N+1) |
| `src/app-layer/jobs/spatial-import.ts` | **#2** — off-thread parse → budget → complexity → topology → persist |
| `src/app-layer/jobs/types.ts` | **#2** — `SpatialImportJobPayload` + JobPayloadMap + JOB_DEFAULTS (on-demand, no-retry) |
| `src/app-layer/jobs/executor-registry.ts` | **#2** — register `spatial-import` |
| `src/app-layer/usecases/spatial-import.ts` | **#2** — `stageLocationSpatialImport` (stage + enqueue; replaces synchronous `importLocationSpatialFile`) |
| `src/app/api/t/[tenantSlug]/locations/[id]/spatial-import/route.ts` | **#2** — per-format 413 + 202 enqueue |
| `src/app/api/t/[tenantSlug]/locations/[id]/spatial-import/[jobId]/route.ts` | **#2** — tenant-pinned status poll |
| `src/components/ui/map/SpatialImportModal.tsx` | **#2** — 202 + poll-to-completion |
| `tests/unit/spatial/limits.test.ts` | **#2** — pure cap/complexity coverage |
| `tests/integration/spatial-import-hardening.test.ts` | **#2** — off-thread persist + real `ST_IsValid` reject + authz + isolation |
| `.github/workflows/ci.yml` | **#3** — lockfile-integrity + npm-signature gates |
| `.github/workflows/release.yml` | **#3** — SPDX SBOM on release |
| `package.json` / `package-lock.json` | **#3** — geo libs pinned caret-free |
| `tests/integration/scim-isolation.test.ts` | **#4** — SCIM cross-tenant fail-closed (18 tests) |

## Decisions

- **On-demand job, not scheduled.** `spatial-import` is enqueued per
  upload (like `evidence-import`/`key-rotation`), so it does NOT bump the
  `SCHEDULED_JOBS` count of 22 in `infrastructure-guards.test.ts`.
  `attempts: 1` — a cap/topology/budget breach is a HARD reject;
  re-running burns the same CPU on the same hostile file. `removeOnFail`
  keeps the failed job so the GET route can surface `failedReason`.
- **`SpatialLimitError` stays pure** (plain `Error` + `statusCode`), not
  an `AppError` subclass — the limits module is dependency-free + fully
  unit-testable. The route is the single HTTP-translation point (catches
  it → `jsonResponse(statusCode)`); the job side surfaces the message via
  `failedReason`.
- **Byte cap enforced on `file.size` at the route**, before the body is
  buffered — an oversized upload never loads its bytes into memory. The
  staging usecase re-asserts the cap as the centralised source of truth
  for non-HTTP callers.
- **The FileRecord is kept, not deleted.** Unlike `evidence-import`
  (which deletes the staging ZIP after extraction), the spatial upload's
  FileRecord *is* the Location's canonical `spatialFileId`; the job
  stamps it on rather than cleaning it up.
- **Whole-import fail-closed on invalid topology** (vs skip-and-continue).
  Security-conservative: a self-intersecting polygon rejects the entire
  import with the offending parcel named, rather than silently persisting
  a subset. The operator fixes + re-uploads.
- **`computePermissions(role)` re-derives the job's write permission**
  from ACTIVE membership (mirrors `resolveTenantContext`, custom-role
  aware) so the off-thread write applies the SAME authorization the
  synchronous path would have — and a permission revoked between
  accept-time and run-time still bounces the import.
