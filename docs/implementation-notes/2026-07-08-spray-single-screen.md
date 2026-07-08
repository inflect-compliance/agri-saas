# 2026-07-08 — Spray job = the single parcel on-click screen

**Prompt:** #3 (user-confirmed reading) — clicking a parcel opens ONE screen
that IS the create-operation form: an exclusive **Fertilizer-XOR-Product**
input selector, dose + unit, water carrier, operator, application technique,
note, a running total from the shared rate-calc, **plus a selector for the
parcel's crop**. Drop the QR block + the bespoke calculator; retire the
6-step `SprayJobWizard`.

## Design

`ParcelDetailSheet` (the bottom-sheet opened on a parcel tap) was rebuilt as
the create-operation form:

- **Exclusive input selector** — a `ToggleGroup` (Product | Fertilizer). The
  item picker switches its pool by kind (FERTILIZER-category items vs the
  rest); water carrier shows for Product only. The running total uses the
  shared `totalLabel` (per-decare basis), replacing the old hectare-only
  `rate × area` calculator.
- **Editable crop** — the read-only crop text became a `CROP_OPTIONS` combobox
  that PATCHes `Parcel.cropType` inline (`/locations/:id/parcels/:parcelId`).
- **Offline-first submit** — the sheet's create button posts through
  `useOfflineSync` (queued in the outbox with no signal), the same path the
  wizard used, for one parcel: the tapped one.
- **Dropped** the QR deep-link block and the standalone calculator.

**Fertilizer-XOR-Product** is enforced in two layers:
- `CreateFieldOperationSchema` (`src/lib/schemas`) — `productItemId` is now
  optional; a `superRefine` rejects both-present and neither-present and
  requires the chosen kind's dose + unit.
- `createFieldOperation` — `resolveChosenInput()` resolves the single chosen
  input (throws on both/neither), and the usecase writes **one** OperationParcel
  line per parcel with the chosen item (was: a treatment line + an optional
  second fertilizer line). Op type defaults from the kind (fertilizer →
  FERTILIZE, else SPRAY). All existing callers send product-only, so the change
  is backward-compatible.

`SprayJobWizard` and its page wiring (the mobile "New spray job" launcher +
its CoachMark, the `showSprayWizard`/`wizardParcelIds` state, `startOperationHere`)
were removed. The desktop `PrescriptionPanel` (multi-parcel inline form) is
unchanged and still valid under the XOR schema (product-only).

## Files

| File | Role |
| --- | --- |
| `src/components/ui/map/ParcelDetailSheet.tsx` | Rebuilt as the single create-operation form |
| `src/lib/schemas/index.ts` | `CreateFieldOperationSchema` XOR superRefine (product now optional) |
| `src/app-layer/usecases/field-operation.ts` | `resolveChosenInput`; single-line-per-parcel write; op-type default by kind |
| `src/app/.../locations/[locationId]/page.tsx` | New sheet props; removed wizard render/state/launcher |
| `SprayJobWizard.tsx` | **Deleted** |
| `messages/en.json` · `messages/bg.json` | `ag.map.parcelSheet.*` create-form keys (EN + BG) |
| `public/openapi.json` | Regenerated for the schema change |
| `tests/e2e/mobile/data-entry.spec.ts` · `map.spec.ts` | Retargeted from the wizard to the sheet create-form |

## Decisions

- **One line per parcel, kind implicit in the Item.** OperationParcel has no
  input-kind column; the chosen Item's category (FERTILIZER vs not) + the
  Task's `operationType` carry the distinction, so no schema/enum churn.
- **Per-parcel create, not multi-select.** The sheet creates for the one tapped
  parcel — the prompt's "clicking a parcel opens one screen". Batch multi-parcel
  create remains on the desktop `PrescriptionPanel`.
- **Kept `PrescriptionPanel`.** The prompt named it under "touches" but asked to
  retire the *wizard*; the desktop inline form is orthogonal and XOR-valid, so
  touching it was out of scope.
- **E2E retargeted, not deleted.** The wizard specs now assert the sheet's
  create-form (input selector + gated create button) via the `?parcelId=`
  deep-link, preserving mobile-data-entry coverage.
