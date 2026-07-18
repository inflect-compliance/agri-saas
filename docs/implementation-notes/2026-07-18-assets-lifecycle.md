# 2026-07-18 — Assets lifecycle & field truthfulness

**Commit:** `<pending>` feat(assets): delete/trash/restore lifecycle + field truthfulness

## Design

The asset soft-delete backend (`deleteAsset` / `restoreAsset` / `purgeAsset` /
`listAssetsWithDeleted`) already existed but had **no UI** — the DELETE route
was caller-less, restore/purge were unreachable, and several fields lied
(status edits dropped, `externalRef` display-only, `tags` a dead column,
`IN_MAINTENANCE` rendered green). This PR wires the lifecycle end-to-end and
makes every asset field truthful.

- **Delete** lives on the detail header (`canAdmin`), via the Epic-67
  undo-toast: click → navigate to the list → the soft-DELETE fires after the
  5 s window; Undo cancels it. Soft-delete is restorable, so this is the
  routine-reversible branch of `docs/destructive-actions.md`, not a
  typed-confirm.
- **Trash** is an in-page, ADMIN-only surface (`DeletedAssetsView`) reached
  from a "Deleted" toggle on the list — **no new navbar entry**. It lists
  soft-deleted rows (existing `?includeDeleted=true` ADMIN route, filtered to
  `deletedAt != null`) with Restore + a typed-confirm permanent purge (the
  operator types the asset name to arm the destructive button — the
  cascading-consequence branch of the doc).
- **Activity** tab is now a real per-asset audit feed (`getAssetActivity`,
  mirroring `getControlActivity`) — bounded (take 50), read-only, hash-chain
  untouched.

## Files

| File | Role |
|------|------|
| `src/app-layer/usecases/asset.ts` | `updateAsset` now forwards `status` (was silently dropped) + `externalRef`; `createAsset` writes `externalRef`; new `getAssetActivity`. |
| `src/app-layer/repositories/AssetRepository.ts` | `list` includes `ownerUser` so the Owner column can show the assignee's name. |
| `src/lib/schemas/index.ts` | `externalRef` added to Create/UpdateAssetSchema. |
| `src/lib/schemas/asset-form.ts` | create-form schema gains `owner` (keeper) + `externalRef`. |
| `src/app/api/t/[tenantSlug]/assets/[id]/activity/route.ts` | New GET → `getAssetActivity`. |
| `.../assets/[id]/page.tsx` | Header delete (undo-toast, canAdmin); real Activity feed; `IN_MAINTENANCE` badge tone + humanized status label. |
| `.../assets/AssetsClient.tsx` | Add button gated on `canWrite`; Owner column = assignee→keeper; new Status column; ADMIN Trash toggle. |
| `.../assets/DeletedAssetsView.tsx` | New — the Trash surface (restore + typed-confirm purge). |
| `.../assets/_form/{NewAssetFields,EditAssetFields,useNewAssetForm,useEditAssetForm}.*` | Keeper + External ref inputs; picker relabelled "Assigned to"; edit submits `externalRef`. |
| `prisma/schema/compliance.prisma` + `prisma/migrations/20260718120000_drop_asset_tags/` | Drop the dead `Asset.tags` column. |
| `messages/{en,bg}.json` | Lifecycle + field + activity strings (real Bulgarian). |
| `tests/guards/epic-67-rollout-coverage.test.ts` | Register the asset-detail delete site. |

## Decisions (forks)

- **B1 delete → undo-toast, not typed-confirm.** Soft-delete is fully
  restorable from the Trash view, so the 5 s undo window is the right weight;
  typed-confirm is reserved for the irreversible *purge*.
- **B4 owner → keep the free-text keeper, make it editable.** PRESERVE lists
  "farm form fields". A farm's keeper (the person physically holding a machine)
  is often not a platform user, so free-text `owner` stays — but it was
  round-tripping invisibly, so both forms now expose it as an editable
  "Keeper" field, and the picker is relabelled "Assigned to" (matching the
  detail page). The list Owner column prefers the assignee's name, falling back
  to the keeper.
- **B5 externalRef → finish; tags → drop.** `externalRef` (an external
  registry / dealer id) is genuinely useful and was already shown on the
  detail page, so it's made editable (input + schemas + usecase). `tags` had
  **zero** read/write path anywhere — a pure orphan — so it's dropped via
  migration rather than left dangling.
- **B6 activity → build, not remove.** The audit trail already records every
  asset event, so the feed had real data on day one; copying the established
  `getControlActivity` shape kept it a 15-line usecase + a thin route.
- **B7 status → tone + label + the dropped-write fix.** Giving `IN_MAINTENANCE`
  an amber badge surfaced a deeper bug: `updateAsset` never forwarded `status`
  to the repo, so status edits were silently lost. Fixed in the same change so
  the new badge actually reflects edits.
- **Trash as a full view-swap, not a filter row.** `?includeDeleted=true`
  returns *all* rows (no task/`_count` enrichment) and deleted rows 404 on
  click, so reusing the live table's columns/nav would misbehave.
  `DeletedAssetsView` is a self-contained surface with its own columns and no
  row-nav — cleaner, and it drops straight into PR C's EntityListPage
  migration.
