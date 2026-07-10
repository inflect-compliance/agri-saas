# 2026-07-11 — Offline journal-entry create (log work, online or off)

**Commit:** `<sha>` feat(journal): offline-capable entry create via useOfflineSync + LogEntry idempotency

## Design

The PWA manifest promises "log work, online or off," but `JournalEntryModal`
POSTed straight to `/journal` with no offline path — a note authored with no
signal was lost. This routes the CREATE path through the same offline outbox
the field-operation flow uses, and makes the delivery exactly-once.

```
JournalEntryModal.submit (create)
   → useOfflineSync().submit({ url:/journal, method:POST, body })
       online  → POST now → 'sent'
       offline → enqueue outbox {id,…} → 'queued' (SW replays on reconnect)
   → onCreated(queued, optimistic)  → parent prepends an optimistic list row
                                       + OfflineSyncBar shows the queued count

replay (SW/fetchSender)  → POST /journal  header Idempotency-Key: <outbox id>
   → createLogEntry(ctx, body, idempotencyKey)
       key + LogEntry exists for (tenantId, clientMutationId) → return original
       else create with clientMutationId = key
       P2002 (concurrent replay) → re-read winner, return it
```

`LogEntry.clientMutationId` is nullable with `@@unique([tenantId,
clientMutationId])` — NULLS-DISTINCT, so ordinary online creates are
unconstrained; only real replays dedupe. This is a direct mirror of the
Task idempotency from the field-operation PR (whose `sync.ts`/`sw.js` already
transmit the outbox id as `Idempotency-Key`).

Photos are OUT OF SCOPE here (a later PR) — this covers the entry's text.

## Files

| File | Role |
|---|---|
| `prisma/schema/journal.prisma` | `LogEntry.clientMutationId String?` + `@@unique([tenantId, clientMutationId])` |
| `prisma/migrations/20260711120000_log_entry_client_mutation_idempotency/` | ADD COLUMN + unique index |
| `src/app-layer/repositories/JournalRepository.ts` | `createLogEntry` persists `clientMutationId`; new `findByClientMutationId` (same include shape) |
| `src/app-layer/usecases/journal.ts` | `createLogEntry(ctx, data, idempotencyKey?)` — pre-lookup short-circuit, key stamp, P2002 backstop in the public wrapper |
| `src/app/api/t/[tenantSlug]/journal/route.ts` | reads `Idempotency-Key` header, threads it |
| `src/app/t/[tenantSlug]/(app)/journal/JournalEntryModal.tsx` | create routes through `useOfflineSync().submit`; emits an optimistic entry + queued flag; edit still `apiPatch` |
| `src/app/t/[tenantSlug]/(app)/journal/JournalClient.tsx` | shared `useOfflineSync` + `OfflineSyncBar`; optimistic prepend; guards navigation for temp-id rows |
| `tests/unit/log-entry-idempotency.test.ts` | mocked dedup (replay short-circuit, key stamp, P2002 re-read) |
| `tests/e2e/journal-offline-create.spec.ts` | @mobile — create offline → queued → reconnect → delivered exactly once |

## Decisions

- **P2002 backstop in the public `createLogEntry` wrapper, not inside the tx.**
  `createLogEntryImpl` does the whole create in one `runInTenantContext`
  transaction; a P2002 thrown inside it poisons that tx, so it can't re-query
  there. Wrapping the impl call keeps the big tx body un-reindented and lets
  the backstop re-read in a fresh tx.
- **Shared `useOfflineSync` lifted to the page.** The modal takes the parent's
  `submit` as `offlineSubmit` so the page's `OfflineSyncBar` pending count
  reflects a queued create immediately (per-hook-instance state otherwise
  wouldn't). Other call sites fall back to the modal's own hook.
- **Optimistic row uses a `optimistic-…` temp id; navigation is guarded.**
  Online, SWR revalidation swaps it for the server row; offline it persists
  until the outbox delivers on reconnect. Tapping a temp-id row is a no-op
  (no server detail page yet).
- **No new i18n strings.** Reuses existing journal keys + `OfflineSyncBar`'s
  own namespace, so no en/bg parity churn.
