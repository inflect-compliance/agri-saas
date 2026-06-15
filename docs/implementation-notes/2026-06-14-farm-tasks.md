# 2026-06-14 — Farm Tasks

**Commit:** `feat(farm-tasks): ag task types + place/equipment links on the IC Task module`
**Branch:** `feat/farm-tasks` (built on `feat/inventory`).

## Design

Assignable farm work, tied to places/crops/equipment, with a calendar —
built ON the IC Task module, **reused unchanged**. The realisation: almost
everything already existed, so this is a thin orchestration + two enum
widenings, not a new module.

```
  createFarmTask ──▶ createTask(type=FARM_TASK, metadataJson={farmTaskType,
        │                       farmTaskCategory}, assignee→TASK_ASSIGNED)
        ├──▶ addTaskLink(LOCATION | PARCEL | EQUIPMENT, id)   (reused)
        └──▶ (calendar shows it via the existing loadTaskEvents — no change)

  listMyFarmTasks ──▶ listTasks({assignee=me, type=FARM_TASK})
                    + listTasks({assignee=me, type=FIELD_OPERATION}) → merge
```

What made it lean (all pre-existing):
- `TaskMetadataJsonSchema` is a free-form `z.record` → the LiteFarm-catalog
  type/category ride in `Task.metadataJson` with **no schema change**.
- `TaskFilters` already supports `type` / `assigneeUserId` / `linkedEntity*`
  → the operator queue is a `listTasks` reuse.
- `loadTaskEvents` (compliance-calendar) already sweeps **every** Task with a
  `dueAt` — farm tasks surface with **no calendar change**.
- Feature-1 added `LOCATION`/`PARCEL` to `TaskLinkEntityType`; `addTaskLink`
  takes a plain `entityType` string → linking to Equipment is enum-only.
- `assignTask` / create-with-assignee already fire `TASK_ASSIGNED`.

New surface: `WorkItemType += FARM_TASK` (the discriminator for general farm
work, distinct from the Feature-1 `FIELD_OPERATION` spray job), and
`TaskLinkEntityType += EQUIPMENT, PLANTING` (PLANTING reserved for a future
crop-planting model). The LiteFarm task-type catalog is a static TS constant
(reference data, not a table).

## Files

| File | Role |
|------|------|
| `prisma/schema/enums.prisma` | `WorkItemType += FARM_TASK`; `TaskLinkEntityType += EQUIPMENT, PLANTING` |
| `prisma/migrations/20260614210000_farm_tasks_enums/` | three `ALTER TYPE … ADD VALUE` (enum-only, no table → no RLS) |
| `src/lib/agriculture/farm-task-types.ts` | the catalog (key/name/category) + `getFarmTaskType`/`isFarmTaskType` |
| `src/app-layer/usecases/farm-task.ts` | `createFarmTask` (validate type + link ownership → reuse createTask/addTaskLink) + `listMyFarmTasks` (operator queue) |
| `src/app-layer/usecases/equipment.ts` | `listEquipment` (backs the equipment picker) |
| `src/app-layer/repositories/JournalRepository.ts` | `+ validParcelIds`, `+ listEquipment` (alongside the existing valid* id-set validators) |
| `src/app/api/t/[tenantSlug]/farm-tasks/route.ts` | POST create + GET operator queue |
| `src/app/api/t/[tenantSlug]/equipment/route.ts` | GET equipment list |
| `src/app/t/[tenantSlug]/(app)/farm-tasks/` | operator queue list + create modal (UI) |
| `THIRD_PARTY_NOTICES.md` | LiteFarm task-catalog attribution (concept-only) |

## Decisions

- **Reuse over rebuild.** `createFarmTask` imports and calls `createTask` /
  `addTaskLink` / `listTasks` from `usecases/task.ts` — zero changes to the
  Task module, TaskLink, or the assignment-notification pipeline. The prompt's
  hard constraint and the cheapest correct path coincided.
- **Catalog as a TS constant, not a DB table.** "names/categories only" is
  exactly an enum-shaped constant; no queryable dimension is needed (the
  discriminator is the `FARM_TASK` WorkItemType, indexed; the fine-grained
  type is display metadata). Per-tenant custom types are a later follow-up.
- **`FARM_TASK` WorkItemType** is the queryable "is farm work" flag, distinct
  from `FIELD_OPERATION` (spray jobs). The operator queue unions both so an
  operator sees all their field work in one place.
- **Link ownership validated BEFORE createTask** so a bad/foreign link never
  leaves an orphan task. Reuses `JournalRepository.validLocationIds` /
  `validEquipmentIds` (+ a new `validParcelIds`) — tenant-scoped id-set checks.
- **`metadataJson` storage** keeps the Task table untouched; the
  free-form `z.record` validator already accepts it.
