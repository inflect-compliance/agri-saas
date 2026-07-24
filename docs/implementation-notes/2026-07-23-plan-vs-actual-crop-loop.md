# 2026-07-23 — Plan-vs-actual crop loop (record actuals → advance status → safe regenerate)

**Commit:** `<sha>` fix(planning): close the plan-vs-actual crop loop end to end

## Design

The crop-planning module could GENERATE a succession board (planned
sow/transplant/harvest per succession) but nothing could feed the ACTUAL
side back in, and re-Generating destroyed whatever state existed. Four
seams were broken; this change re-connects them into one loop:

```
  RecordActualMenu (board row)                    ← 1. record actuals
        │ POST /journal { plantingLinks:[{plantingId, stage}] }
        ▼
  CreateLogEntrySchema (now carries plantingLinks) ← 1. schema was stripping it
        │
        ▼
  journal.createLogEntry
        ├── JournalRepository.createLogEntry → LogPlanting row (the ACTUAL)
        └── advancePlantingStatusForLinks    ← 2. PLANNED→SOWN→TRANSPLANTED→HARVESTED
        ▼
  getCropPlanProgress → actual date + status  → board renders the CircleCheck
        ▲
        │  3. re-Generate must NOT wipe any of the above
  generatePlantings  (stable-identity UPSERT, not delete-and-recreate)
```

### FORK decision (step 3) — option (a): stable identity

The task offered two ways to make regenerate safe. **We took option (a):
key regenerate on the stable `(cropPlanId, successionNumber)` identity and
UPSERT**, rather than (b) adding a Planting FK to `TaskLink` + relying on
status-preservation to survive a delete-and-recreate.

Why (a):

- **It preserves planting ids by construction.** `LogPlanting` FKs to the
  planting id and `TaskLink.entityId` *is* the planting id, so keeping the
  id stable is exactly what stops a re-run from wiping actuals or
  orphaning + duplicating tasks — no cascade wiring needed.
- **(b) doesn't actually converge once status advancement is real.**
  Delete-only-PLANNED + `createMany(1..N)` means a surviving SOWN
  succession 1 gets a *second* PLANNED succession 1 minted beside it — two
  rows for the same succession. Avoiding that requires keying on
  successionNumber anyway, i.e. you end up at (a). And (b)'s cascade only
  removes the dangling task *links*, leaving the orphaned FARM_TASK rows —
  still duplicates.
- A DB `@@unique([tenantId, cropPlanId, successionNumber])` makes "one row
  per succession" a structural invariant (defence in depth beside the
  app-layer reconcile), and its `(tenantId, cropPlanId)` prefix subsumes
  the old `@@index([tenantId, cropPlanId])`, which was dropped.

`generatePlantings` now, inside one tx: reads the existing rows once (no
read-in-loop), `createMany`s the successions that don't exist, UPDATEs the
still-`PLANNED` ones in place (dates/allocation may have shifted),
leaves SOWN+ rows untouched, and deletes only the `PLANNED` rows whose
succession is no longer in the plan (it shrank). The task fan-out is
unchanged — its batched idempotency check (`collectExistingStageTaskKeys`)
already dedupes by the now-stable planting id, so a re-run creates zero
duplicate tasks.

### Status advancement (step 2)

`advancePlantingStatusForLinks(db, ctx, links)` lives in `crop-planning.ts`
(domain logic) and is called from `journal.createLogEntry` inside the same
transaction, so the LogPlanting write and the status move commit
atomically. It is **monotonic-forward only** — a `STATUS_RANK` guard means
recording a sow after a harvest never regresses `HARVESTED → SOWN`. Only a
`DONE` entry advances status; a `PLANNED` (future-dated) entry records the
intent without moving the lifecycle.

### Generate-error UX (step 6)

The modal used to `setError(...)` then `setOpen(false)` + navigate on the
same tick, so the `CROP_PLAN_NOT_READY` message never rendered. Reconciled
with "variety is optional on a plan but Generate requires it": the modal
now attempts generation **only when a variety is chosen**, and swallows a
generation failure rather than flashing an error the navigation hides. In
both the no-variety and lacks-maturity cases the user lands on the plan,
where a new inline hint (`emptyHintVariety` / `emptyHintNoVariety`) guides
them to add a maturity-bearing variety and press Generate — instead of a
silently-empty plan. A helper line under the "Generate now" checkbox
appears when it's checked without a variety.

## Files

| File | Role |
| --- | --- |
| `src/lib/schemas/index.ts` | Add `plantingLinks` (+ `LogPlantingLinkSchema`) to `CreateLogEntrySchema` — the field the `.strip()` was silently dropping, so the journal write path is finally reached. |
| `src/app-layer/usecases/crop-planning.ts` | Stable-identity UPSERT in `generatePlantings`; new exported `advancePlantingStatusForLinks` + `STAGE_TO_STATUS` / `STATUS_RANK`. |
| `src/app-layer/usecases/journal.ts` | Call `advancePlantingStatusForLinks` for a DONE entry with planting links (same tx). |
| `prisma/schema/planning.prisma` | `Planting`: `@@unique([tenantId, cropPlanId, successionNumber])`, drop the now-redundant `@@index([tenantId, cropPlanId])`. |
| `prisma/migrations/20260723130000_planting_stable_identity/` | Drop the old composite index, add the unique. |
| `src/app/.../planning/[cropPlanId]/PlantingBoard.tsx` | Write-gated `RecordActualMenu` per row (Popover of applicable stages) → POSTs a linked journal entry → revalidates the board. |
| `src/app/.../planning/[cropPlanId]/page.tsx` | Inline empty-state hint (Card `elevation="inset"`) when a writable plan has no plantings. |
| `src/app/.../planning/NewCropPlanModal.tsx` | Generate only with a variety; land-on-plan-with-hint instead of the vanishing error; checkbox helper line. |
| `messages/{en,bg}.json` | New `planning.board` record-actual keys, `planning.detail` empty-hints, `planning.newPlan.generateNeedsVariety`. |
| `public/openapi.json` + contract snapshot | Regenerated for the new `plantingLinks` field. |
| `tests/integration/crop-plan-actuals-loop.test.ts` | End-to-end proof: record a sow → actual + status; re-Generate preserves the actual and creates zero duplicate tasks. |

## Decisions

- **Fan out tasks over ALL the plan's plantings on regenerate, not just
  the newly-created ones.** With stable ids the idempotency batch skips
  every existing stage task, so this is safe and also reconciles a SOWN
  row that predates the task fan-out — at zero duplicate cost.
- **Status advancement gated on `entry.status === 'DONE'`.** A planned
  future entry should record the intended actual date without claiming the
  work is done.
- **`advancePlantingStatusForLinks` does its own batched read** rather than
  threading the journal usecase's validation rows through. One extra
  `findMany` on the rare record-actual path keeps the domain boundary
  clean (mirrors how `recordHarvestLot` takes `db` and self-contains).
- **The DB unique is defence-in-depth, not the mechanism.** The app-layer
  reconcile already prevents duplicate successions; the unique makes a
  concurrent double-Generate fail loudly instead of racing two rows in.
