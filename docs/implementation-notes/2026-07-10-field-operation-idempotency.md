# 2026-07-10 — Offline exactly-once for field-operation create

**Commit:** `<sha>` feat(offline): idempotent createFieldOperation (kill duplicate-Task replay)

## Design

The offline operator PWA was exactly-once everywhere except one path.
`createFieldOperation` minted a **brand-new Task on every call** — no dedup.
The outbox re-sends a queued spray job whenever a flaky rural-LTE connection
drops mid-flight (the in-page `fetchSender` and the service-worker background
flush both drain the same queue). So one spray job could post two Tasks — two
`TSK-N` keys, two prescription sets, two assignment emails.

The fix threads the outbox-item id — which `outbox.ts` already documents as
"the idempotency handle on replay" — end to end as an HTTP `Idempotency-Key`,
and dedupes on it server-side:

```
ParcelDetailSheet.doSubmit → useOfflineSync().submit → outbox item {id,url,body}
   │  (online)  fetchSender ──┐
   │  (offline) sw.js flush ──┤→  POST /locations/:id/operations
   │                          │      header: Idempotency-Key: <item.id>
   ▼                          ▼
 createFieldOperation(ctx, locationId, body, idempotencyKey)
   ├─ key present + Task exists for (tenantId, clientMutationId) → return original 201 body
   ├─ else create Task with clientMutationId = key
   └─ P2002 on the unique index (concurrent replay) → re-read winner, return it
```

A replay returns the same `{ taskId, taskKey, locationId, parcelCount }` with
no new rows. `Task.clientMutationId` is **nullable**, and Postgres unique
indexes are NULLS-DISTINCT by default, so ordinary online creates (no key)
each store NULL and never collide — the constraint only bites real replays.

## Files

| File | Role |
|---|---|
| `src/lib/offline/sync.ts` | in-page `fetchSender` sets `Idempotency-Key: item.id` |
| `public/sw.js` | service-worker background flush sets the same header |
| `prisma/schema/compliance.prisma` | `Task.clientMutationId String?` + `@@unique([tenantId, clientMutationId])` |
| `prisma/migrations/20260710120000_task_client_mutation_idempotency/` | ADD COLUMN + unique index |
| `src/app-layer/repositories/WorkItemRepository.ts` | `create` accepts + persists `clientMutationId` |
| `src/app-layer/usecases/task.ts` | `createTask` input carries `clientMutationId` through |
| `src/app-layer/usecases/field-operation.ts` | pre-lookup short-circuit, key stamp, P2002 race backstop |
| `src/app/api/t/[tenantSlug]/locations/[id]/operations/route.ts` | reads the `Idempotency-Key` header, threads it |
| `tests/unit/field-operation-idempotency.test.ts` | mocked: replay short-circuit, no-key create, key stamp, P2002 re-read |
| `tests/integration/field-operation-idempotency.test.ts` | DB-backed: real replay = one row; unique index rejects raw dup; NULL keys coexist |
| `tests/guardrails/offline-pwa-coverage.test.ts` | asserts BOTH senders transmit the handle |

## Decisions

- **`@@unique` (full index), not the ledger's partial `WHERE … IS NOT NULL`.**
  The StockTransaction ledger keeps its partial index in raw SQL with no schema
  `@@unique`. Here the prompt asked for `@@unique([tenantId, clientMutationId])`
  in the schema; since the column is nullable and Postgres defaults to NULLS
  DISTINCT, the full index is functionally equivalent for our purpose (online
  no-key creates are unconstrained) while staying Prisma-managed (no migrate
  drift). The partial index is only a size optimisation we don't need.
- **Pre-lookup + P2002 backstop, not lookup-or-`upsert`.** `createFieldOperation`
  does far more than one insert (validate catalog, mint the `TSK-N` key from an
  atomic counter, write N prescription lines, link the location, emit audit +
  automation). A cheap pre-read short-circuits the common replay before any of
  that; the unique-index P2002 catch covers only the tight concurrent-replay
  race. Threading the key into `createTask` keeps the key mint / counter logic
  in one place.
- **Header, not body field.** The idempotency key is transport metadata about
  the *delivery attempt*, not part of the operation's domain payload — so it
  rides the `Idempotency-Key` header (route → 4th usecase arg) and never
  touches `CreateFieldOperationSchema`.
