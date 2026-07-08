# 2026-07-07 — Crop planning per parcel

**Prompt:** #9 — plan crops per parcel, not per whole location. Thread a
parcel dimension through the crop-planning config → succession engine →
Planting rows → board/detail UI, so per-parcel signals resolve.

## Design

The `Planting` model already carried a nullable `parcelId` + `Parcel`
relation + `@@index([tenantId, parcelId])` (they shipped with the planning
schema but were never populated). The gap was:

1. **No plan-level parcel.** `CropPlan` had `locationId` but no `parcelId`.
   Added `CropPlan.parcelId String?` + `parcel Parcel?` relation +
   `@@index([tenantId, parcelId])`, and the `Parcel.cropPlans CropPlan[]`
   back-relation. A plan targets one parcel within its location (nullable —
   plans may stay location-level).
2. **The write path never stamped it.** `generatePlantings` now stamps
   `parcelId: plan.parcelId ?? null` on every generated Planting (beside the
   existing `locationId`), so the `AgroSignal.plantingId → Planting.parcelId`
   chain resolves to a parcel.
3. **No UI to pick or see it.** `NewCropPlanModal` gained a Location picker +
   a Parcel picker; the parcel picker fetches the selected location's parcels
   on demand (`GET /locations/:id/parcels?simplify=0.01`) and sorts them by
   area **descending** (largest first, per #2). The `PlantingBoard` gained a
   Parcel column; the plan detail overview shows the plan's parcel.

Validation: `createCropPlan` / `updateCropPlan` verify the parcel belongs to
the tenant and — when a location is also chosen — that the parcel sits within
that location (`PARCEL_LOCATION_MISMATCH`).

The succession engine (`src/lib/planning/succession.ts`) is untouched — it is
pure date/allocation math with no spatial dimension; parcel is stamped at
persistence, not computed.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/planning.prisma` | `CropPlan.parcelId` + relation + index |
| `prisma/schema/agriculture.prisma` | `Parcel.cropPlans` back-relation |
| `prisma/migrations/20260707180000_crop_plan_parcel/migration.sql` | Column + index + FK |
| `src/app-layer/usecases/crop-planning.ts` | parcel in inputs, validation, create/update, generate stamp, list/progress includes |
| `src/app/api/.../planning/crop-plans/route.ts` · `[cropPlanId]/route.ts` | `parcelId` in Zod schemas |
| `src/app/.../planning/page.tsx` | fetch `listLocations`, pass to client |
| `src/app/.../planning/CropPlansClient.tsx` | thread `locations` to the modal |
| `src/app/.../planning/NewCropPlanModal.tsx` | Location + Parcel pickers (on-demand fetch, size-sorted) |
| `src/app/.../planning/[cropPlanId]/PlantingBoard.tsx` | Parcel column |
| `src/app/.../planning/[cropPlanId]/page.tsx` | Parcel in overview |
| `messages/en.json` · `messages/bg.json` | planning location/parcel labels (EN + BG) |
| `tests/unit/crop-planning.test.ts` | `parcelId` stamped-on-generate assertion |

## Decisions

- **One parcel per plan (not a set).** The prompt allowed "a parcel — or a
  chosen set of parcels". A single `CropPlan.parcelId` is the coherent MVP:
  every planting in the plan inherits that parcel, the board/detail read
  cleanly, and no many-to-many join table is needed. A parcel *set* can be a
  later extension without breaking this shape.
- **On-demand parcel fetch, not server pre-load.** The modal fetches parcels
  only for the selected location. Pre-loading every location's parcels
  server-side would be an N+1 (or a heavy geometry payload); the existing
  `?simplify=0.01` keeps the on-demand response light.
- **Parcel sorted by area desc** in the picker — reuses the #2 "largest field
  first" convention so the picker leads with the fields that matter.
- **AgroSignal unchanged.** The `plantingId → parcel` chain resolves purely by
  stamping `Planting.parcelId`; the location-scoped `AgroSignal` unique key
  was left as-is (widening it is out of scope and risks the dedup semantics).
