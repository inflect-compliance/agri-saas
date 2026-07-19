# 2026-07-19 — Journal: auto-entry audit + module gating

**Commit:** `<pending>` feat(journal): audit auto-generated entries, gate the JOURNAL module

## Design

Roadmap prompt A of 3, on a locked product decision: **journal entries —
including the auto-generated `INPUT_APPLICATION` records the field-op path
mints — stay fully editable and deletable by any writer.** No append-only lock,
no SYSTEM-entry immutability.

That is safe because the regulated ДНЕВНИК sources its tables from
`OperationParcel`, not `LogEntry` (the #331 ratchet pins this: the
chemical/fertilizer register reads `db.operationParcel.findMany`, and
`LogEntry` contributes only frozen `conditionsJson` cert snapshots and
OBSERVATION rows). An edit can't corrupt the filed diary.

But it makes the **hash-chained audit trail the accountability layer that
replaces immutability** — and that layer had a hole: the field-op path called
`JournalRepository.createLogEntry` directly and wrote no CREATE event, so
auto-generated entries had an edit/delete history with no beginning.

## Files

| File | Role |
|------|------|
| `src/app-layer/usecases/journal-write.ts` | **New** — `createLogEntryWithAudit(db, ctx, input, origin)`: the single audited seam. |
| `src/app-layer/usecases/journal.ts` | Manual path routes through the seam (its inline `logEvent` removed). |
| `src/app-layer/usecases/inventory.ts` | Field-op path routes through the seam instead of the repository. |
| `src/app/api/t/[tenantSlug]/journal/**` (5 files, 9 handlers) | `assertModuleEnabled(ctx, 'JOURNAL')`. |
| `src/app/t/[tenantSlug]/(app)/journal/layout.tsx` | **New** — `requireModule(ctx, 'JOURNAL')`, the page-side twin. |
| `.../journal/[id]/page.tsx` + `messages/{en,bg}.json` | Informational origin badge. |
| `tests/unit/journal-write.test.ts` | **New** — locks the seam. |
| `tests/unit/inventory.test.ts` | Asserts the auto path emits CREATE, and does not when JOURNAL is off. |
| `tests/guardrails/module-gate-coverage.test.ts` | The 5 journal routes registered. |

## Decisions

- **A shared seam, not a duplicated `logEvent`.** The prompt allowed emitting
  the event at the call site, but that's how the paths drifted in the first
  place. Both origins now go through one function, so they cannot diverge again.
- **It lives in its own module.** `journal.ts` already imports `recordHarvestLot`
  from `inventory.ts`; putting the helper in either would close that into an
  import cycle. Hoisted function declarations would have survived it, but a
  later refactor to `const` arrows would break at module-init in a way that's
  painful to diagnose. `journal-write.ts` is acyclic by construction.
- **`action` stays `'CREATE'`; origin goes in `detailsJson`.** A distinct action
  string (`LOG_ENTRY_AUTO_CREATED`) would force entries in the ag-audit
  registry, the Grafana dashboard and the runbooks for no analytical gain.
  `AuditDetailsJsonSchema` is `.passthrough()`, so `origin: 'manual' |
  'field_operation'` (plus `operationParcelId` when present) rides along and the
  two are still distinguishable in the chain.
- **Module fork → GATE the routes** (rather than declaring journal always-on and
  deleting the check in `inventory.ts`). JOURNAL is simple-mode core and
  FREE-tier, so the *plan* never denies it — but a tenant **can** toggle it off,
  and until now that toggle did nothing to the journal's own surface: the
  auto-emission path honoured it while all nine CRUD handlers and every page
  stayed open. The sibling simple-mode module INVENTORY already gates its six
  API routes, so gating follows the established pattern rather than inventing
  one. Both halves landed (API `assertModuleEnabled` + route-group
  `requireModule`), since the codebase treats those as twins, not alternatives.
  The non-throwing read in `recordInputApplication` stays as-is — it is a
  *feature toggle* ("should this inventory op also write a journal record?"),
  deliberately non-throwing to avoid a nested transaction, not an access gate.
- **Badge is informational only.** It renders on `operationParcelId != null`,
  needs no `source` column, and restricts nothing — a farmer editing an
  auto-generated entry just sees where it came from. Copy follows the current
  Bulgarian („От земеделска операция"); #333 retired „полск\*", and the two
  „полева" stragglers elsewhere were deliberately not copied.

## Verification

The #331 diary ratchet reads only `farm-record-diary.ts`, which this PR does
not touch — and the source-of-truth split it pins is exactly what makes the
"entries stay editable" decision safe.
