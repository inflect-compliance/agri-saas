# 2026-07-23 — Crop-planning surface data integrity (soil / GDD / journal / allocation / polish)

**Commit:** `<sha>` feat(planning): back every board/detail value with a real data source

Every value on the planning surfaces now has a real data source or is
hidden; no surface shows a raw enum inconsistently; the Journal tab is
scoped, not misleading. Also fixes a Prisma bug the plan-vs-actual
integration test caught.

## 1. Soil (flag 7) — FEED IT

`getPlantingSoilSuitability` always returned `unknown` because
`CropVariety.soilDefaultsJson` was never written. Now:

- `scripts/import-crop-varieties.ts` carries a `CROP_AGRO_DEFAULTS` map
  (per-crop pH band, preferred USDA textures, drainage) — generic
  public-domain norms, same provenance as the succession figures — and
  writes `soilDefaultsJson` on every seeded variety.
- `createCropVariety` (usecase + `crop-varieties` route Zod schema) accepts
  `soilDefaultsJson`, so a user-created variety can carry preferences too.
- `soil.ts:71` planting lookup gained `deletedAt: null` (matching
  `agro-gdd.ts`).

The `SoilCell` now shows real good/caution/poor flags; its `—` fallback
(no soil / no preferences) is preserved.

## 2. GDD (flag 8) — real maturity %

`targetGdd` was hardcoded null and `baseTempC` a flat 10 °C for every crop.
Now `CropVariety` has two new columns (migration
`20260723140000_crop_variety_gdd`):

- `gddBaseC` — the crop's GDD base temperature (warm-season ≈ 10, cool ≈ 4–5).
- `gddToMaturity` — accumulated-GDD-to-maturity target, seeded as
  `round(daysToMaturity × the crop's typical daily heat units)`, so a
  longer-maturing variety of the same crop gets a proportionally larger
  target.

`agro-gdd.ts` reads them (falling back to the 10 °C default + null target),
and the `GddCell` shows a maturity % when a target exists — otherwise it
stays raw accumulated GDD (the `—` fallback and the honest "no target"
state both preserved).

## 3. Journal tab scope (flag 9) — scoped

Prompt 1 landed `plantingLinks`, so the plan-detail Journal tab now fetches
`/journal?cropPlanId=<id>`. `JournalRepository._buildWhere` filters
`LogEntry → LogPlanting → Planting.cropPlanId`, so the tab shows only this
plan's recorded actuals, not the whole tenant journal.

## 4. Allocation (flag 10) — surfaced

`bedLengthM` / `rowsPerBed` / `targetAreaM2` were fetched + consumed by the
engine but never shown. They're now in the Overview grid (shown only when
set — a plan uses one of plants / bed geometry / area) and editable in both
the create and edit modals.

## 5. Polish (flag 11)

- Detail header status renders via `AgStatusBadge` (humanized "Draft", not
  raw "DRAFT") — matching the list. The dead `STATUS_VARIANT` map is gone.
- The Overview notes block is now genuinely reachable: the create modal
  gained a notes field (edit already had one).
- The list gains dynamic **Season** + **Crop** filters (`filter-defs.ts`,
  options derived from the catalog the page loads), wired through
  `listCropPlans` (`cropTypeId`) + the crop-plans GET route.

## Bug fix — LogPlanting nested create

The plan-vs-actual integration test caught a `PrismaClientValidationError`:
`JournalRepository.createLogEntry`'s `plantings: { create }` passed
`tenantId` explicitly, but on `LogPlanting` — whose `planting` relation
also keys on `tenantId` — Prisma rejects it ("Unknown argument tenantId").
`tenantId` now flows from the parent LogEntry (mirroring the `quantities`
nested create). Local test suites don't hit a DB, so only the DB-backed
integration test surfaced it — exactly what it's for.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/planning.prisma` + migration | `CropVariety.gddBaseC` + `gddToMaturity`. |
| `scripts/import-crop-varieties.ts` | `CROP_AGRO_DEFAULTS` → seed `soilDefaultsJson` + GDD params per variety. |
| `src/app-layer/usecases/crop-planning.ts` | `createCropVariety` accepts soil/GDD; `listCropPlans` gains `cropTypeId`. |
| `src/app-layer/usecases/agro-gdd.ts` | per-variety base temp + maturity target. |
| `src/app-layer/usecases/soil.ts` | `deletedAt: null` on the planting lookup. |
| `src/app-layer/repositories/JournalRepository.ts` | `cropPlanId` journal filter; LogPlanting nested-create fix. |
| `src/app/api/.../planning/crop-varieties/route.ts` | soil/GDD Zod fields. |
| `src/app/api/.../planning/crop-plans/route.ts` | `cropTypeId` query. |
| `src/app/api/.../journal/route.ts` | `cropPlanId` query. |
| `.../planning/[cropPlanId]/page.tsx` | AgStatusBadge status, allocation grid, scoped journal. |
| `.../planning/[cropPlanId]/PlantingBoard.tsx` | GddCell maturity %. |
| `.../planning/{NewCropPlanModal,EditCropPlanModal}.tsx` | allocation + notes inputs. |
| `.../planning/filter-defs.ts` + `CropPlansClient.tsx` | Season + Crop filters. |
| `messages/{en,bg}.json` | new keys (maturity tooltip, allocation, filters). |

## Decisions

- **GDD target scales with the variety's own days-to-maturity** (× a
  per-crop daily-heat-unit constant) rather than a flat per-crop number, so
  a beefsteak tomato's target exceeds a cherry's. It is a MODELLED estimate,
  labelled as such — never presented as guaranteed.
- **Soil/GDD defaults are per-crop, applied crop-wide** — soil preferences
  and base temp barely vary between varieties of one crop, so a per-crop map
  keeps the catalog honest and maintainable.
- **`drainagePreference` is calibrated against the engine's own
  `DRAINAGE_BY_TEXTURE` table** — Loam / Silt loam classify as
  *moderate*-draining, so a moisture-loving crop (kale, chard, spinach,
  brassicas, sweet-corn, leek) whose preferred texture is Loam uses
  `'moderate'`, not `'well'`. A `'well'` preference there would fire a false
  `caution` on an otherwise-ideal Loam parcel (texture matches, drainage
  tendency doesn't). `'well'` is reserved for crops that genuinely want sharp
  drainage — root crops on sand, cucurbits, alliums prone to rot in wet ground.
- **Allocation fields render only when set** — a plan uses ONE allocation
  method, so showing three mostly-empty cells would be noise.
