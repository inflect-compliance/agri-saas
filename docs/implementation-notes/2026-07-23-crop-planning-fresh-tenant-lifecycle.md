# 2026-07-23 — Crop planning: fresh-tenant path, plan lifecycle, dead-code cleanup

**Commit:** `<sha>` feat(planning): fresh-tenant self-service, plan lifecycle/edit/delete, dead-code cleanup

Closes three gaps left after the plan-vs-actual loop fix: a fresh tenant
couldn't reach a working "create plan" state, plans were frozen at DRAFT
with no edit/delete, and several exported planning usecases/routes had no
production caller.

## Part 1 — Fresh-tenant dead-end

A CropPlan requires a Season; seasons were never seeded, `/planning/seasons`
was nav-orphaned, and the create-plan modal showed a dead `noSeasons`
placeholder. Both halves are addressed:

**(a) Season management surfaced.** The planning list header gains a
"Seasons" button → the existing (now de-orphaned) `/planning/seasons` page.

**(b) Cold-start removed — FORK: create-a-season-inline (not tenant-init seed).**
The modal's Season Combobox now has a "Create `<name>`" affordance
(`onCreate`) that mints a season with a sensible current-year default
window; the crop-type and variety fields got the same treatment (crop-type
via `onCreate`; variety via a compact inline form carrying the
`daysToMaturity` the engine needs). So a fresh tenant builds season → crop
type → variety and creates + generates a plan **entirely inside the modal**.

*Why inline over seeding `createTenantWithOwner`:* seeding a Season at
tenant creation broke teardown in all 11 integration tests that create a
tenant via `createTenantWithOwner` and later delete it — Season's tenant FK
has no `onDelete: cascade`, so a dangling season blocks the tenant delete.
It also put planning bootstrap on the auth-critical tenant-creation path.
Inline creation avoids both. `seedDefaultSeason` (in `planning-defaults.ts`)
is retained and called from **`prisma/seed.ts`** only, so the dev tenant
still opens with a working season; it's the same default window the modal's
inline create uses.

## Part 2 — Plan lifecycle + edit + delete (FORK: finish it)

`updateCropPlan` + PATCH existed but nothing called them; there was no
DELETE. The status enum + board clearly intend a lifecycle, so it's wired,
not removed:

- **Lifecycle** — the detail-page actions menu offers the valid transitions
  from the current status (DRAFT→ACTIVE, ACTIVE→COMPLETED, →CANCELLED,
  reopen), each a PATCH `{ status }`. The COMPLETED/CANCELLED filter options
  are now reachable.
- **Edit** — a new `EditCropPlanModal` PATCHes the editable fields (name,
  variety, method, schedule, plants, notes). Season + crop type are
  structural and stay fixed after creation (they aren't in the update
  usecase either).
- **Delete** — new `deleteCropPlan` usecase (explicit **soft-delete** —
  stamp `deletedAt`, like the journal repo — so plantings + recorded
  actuals survive; a hard delete would cascade them away) + a DELETE route,
  admin-gated. The detail page confirms via `ConfirmDialog` (danger) then
  navigates back to the list.

*Delete UX — ConfirmDialog, not undo-toast:* the task suggested the
undo-toast convention, but this delete lives on a detail page that
navigates away on success, where undo-toast's optimistic-remove-from-list
model doesn't fit, and Epic 67 documents typed-confirmation for deliberate
top-level-entity deletion. ConfirmDialog is the repo-aligned choice here.

## Part 3 — Dead planning code

- **`getSeason`** — deleted (zero callers; the seasons list already carries
  the row data an edit needs).
- **`updateSeason`** — wired: new PATCH `/planning/seasons/[seasonId]` route
  + a per-row edit affordance in `SeasonsClient` (the create modal was
  generalized to `SeasonModal`, handling both POST and PATCH).
- **`createCropType` / `createCropVariety` + routes** — wired (not deleted):
  the inline crop-type/variety creation in the plan modal gives them
  production callers. The routes couldn't be deleted anyway — the
  `ag-crop-plan` E2E seeds through them and `module-gate-coverage` pins
  them.

## Files

| File | Role |
| --- | --- |
| `src/app-layer/usecases/crop-planning.ts` | `+deleteCropPlan` (soft-delete, admin-gated); `-getSeason` (dead). |
| `src/app-layer/usecases/planning-defaults.ts` | New `seedDefaultSeason` (dev seed only). |
| `src/app/api/.../planning/crop-plans/[cropPlanId]/route.ts` | `+DELETE`. |
| `src/app/api/.../planning/seasons/[seasonId]/route.ts` | New PATCH → `updateSeason`. |
| `prisma/seed.ts` | Seed the default season for the dev tenant (idempotent). |
| `.../planning/[cropPlanId]/page.tsx` | Actions menu: lifecycle transitions, Edit, Delete. |
| `.../planning/[cropPlanId]/EditCropPlanModal.tsx` | New edit modal (PATCH). |
| `.../planning/NewCropPlanModal.tsx` | Inline season / crop-type / variety create. |
| `.../planning/CropPlansClient.tsx` | Header "Seasons" link (de-orphan). |
| `.../planning/seasons/SeasonsClient.tsx` | Per-row edit → `SeasonModal` (POST + PATCH). |
| `messages/{en,bg}.json` | New planning keys (lifecycle, editPlan, inline-create, season edit). |

## Decisions

- **Inline-create reuses the Combobox `onCreate` primitive** for season +
  crop type (name-only is correct there); variety needs a real form because
  `daysToMaturity` is load-bearing for the succession engine.
- **A custom crop VARIETY created inline carries only name + method +
  maturity.** That's enough to schedule + Generate; the richer agronomic
  fields (spacing, seed size) come from the imported CC0 catalog, not the
  quick-create.
- **`deleteCropPlan` is ADMIN-gated** (heavier than edit) and soft — the
  `listCropPlans` / `getCropPlan` `deletedAt: null` filters already hide it.
