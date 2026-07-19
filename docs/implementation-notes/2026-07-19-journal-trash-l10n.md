# 2026-07-19 — Journal: trash, localized enums, equipment + cost

**Commit:** `<pending>` feat(journal): delete + trash, localized enums, equipment + cost, SSR deep links

## Design

Roadmap prompt B of 3. Four independent gaps on the journal surface.

### 1. Delete + trash
The soft `DELETE /journal/[id]` existed with no caller, and `restore`/`purge`
were fully dead routes. Now: a detail-header delete (canWrite, Epic-67
undo-toast — entries are freely deletable by design, and a soft delete is
restorable, so this is the routine reversible branch), plus an in-page
**ADMIN-only Trash** reached from a toggle on the list, with per-row Restore and
a typed-confirm purge. Zero dead journal routes remain.

There is **no lock branch** — prompt A locked entries as fully editable and
deletable, so the "SYSTEM entries show the lock instead" variant doesn't exist.

### 2. Localized authoring enums
The modal's Type/Status comboboxes rendered the English `LOG_ENTRY_*_LABELS`
literals, and the measure dropdown rendered the raw Prisma enum
(`COUNT`, `WEIGHT`, …) in both the modal and the detail quantities tab. All now
resolve through `journalEnums`. The English maps survive only as the value
source and a membership guard.

### 3. Equipment + cost
An equipment multi-picker (Epic-55 `Combobox multiple`, fed by the existing
`GET /equipment`), and cost surfaced as an input + a detail line.

### 4. SSR deep links
The server allow-list was `['q','type','status']` while the API supports seven
filters, so a shared link with a date range or a location painted unfiltered
and then re-fetched on the client. Widened to match `JournalQuerySchema`
exactly.

## Decisions

- **Cost fork → surface, not strip.** The columns exist, the schemas accept it,
  and `updateLogEntry` already persisted it — so rows may already carry values.
  Stripping would discard live data and be the larger change; surfacing turns a
  dark-but-accepted field into a real one. `costCurrency` is displayed but not
  yet editable (there is no tenant-currency picker to bind it to); the input
  sets the amount only.
- **The Trash view uses SWR, not react-query.** `DeletedAssetsView` is the
  structural template, but it's a react-query component and the entire journal
  tree is on `useTenantSWR`. Copying it verbatim would drag a second data
  library into the journal for one screen, so the structure was ported and the
  data layer swapped.
- **`listDeleted` is a separate repository method**, not an `includeDeleted`
  flag on `_buildWhere`. The live-list invariant (`deletedAt: null`) stays
  unconditional and can't be switched off by a stray filter object.
- **The Trash is ADMIN-gated** because restore and purge — the only two things
  reachable from it — are both `assertCanAdmin`. Listing what you can't act on
  would be theatre.
- **`journalEnums.operationType.*` had to be created.** The prompt referred to
  "the existing БАБХ operation-type keys", but no such namespace exists:
  `FieldOperationType` is `SPRAY | FERTILIZE | SEED | OTHER` and the only
  near-match, `taskEnums.category`, is a different concept (it would have
  covered `OTHER` and nothing else).
- **Equipment is seeded into the edit payload.** `updateLogEntry` **replaces**
  `equipmentIds` wholesale, and the detail page's edit-modal payload previously
  passed `locationIds` but not `equipmentIds`. Adding the picker without also
  seeding it would have silently cleared every entry's equipment links on the
  next edit — a data-loss bug introduced by the feature that adds the field.

## Files

| File | Role |
|------|------|
| `src/app-layer/repositories/JournalRepository.ts` | `listDeleted` (deleted-only, `take: 200`). |
| `src/app-layer/usecases/journal.ts` | `listDeletedLogEntries` (ADMIN). |
| `src/app/api/t/[tenantSlug]/journal/route.ts` | `?deleted=true` branch. |
| `.../journal/DeletedJournalView.tsx` | **New** — the Trash surface (SWR). |
| `.../journal/JournalClient.tsx` | `canAdmin` prop, Trash toggle + early return, localized Operation column. |
| `.../journal/[id]/page.tsx` | Delete button (undo-toast), localized measure, cost line, equipment/cost seeding. |
| `.../journal/JournalEntryModal.tsx` | Localized Type/Status/measure options; equipment picker; cost input. |
| `.../journal/filter-defs.ts` | `FIELD_OPERATION_TYPES` membership guard. |
| `.../journal/page.tsx` | SSR allow-list widened to the full API filter set; passes `canAdmin`. |
| `messages/{en,bg}.json` | `journal.trash.*`, `journalEnums.measure.*`, `journalEnums.operationType.*`, equipment/cost/delete keys. |
| `tests/guards/{filter-toolbar,columns-dropdown}-coverage.test.ts` | Trash-view exemptions (note the differing key formats and the `(c)` prefix). |

## Follow-up

`occurredFrom` / `occurredTo` / `locationId` are now honoured by SSR and the
API but have no client-side filter def, so a deep link carrying them renders
the right rows while the toolbar shows no corresponding chip. Adding those
filter defs is the natural next step.
