# 2026-07-11 — Optimistic lock for markOperationParcel (offline staleness)

**Commit:** `<sha>` feat(offline): optimistic lock for markOperationParcel (409 on stale replay)

## Design

Idempotency (already shipped) makes offline field marks exactly-once, but a
mark queued at 09:20 could still replay hours later and blindly overwrite
whatever the row became — `markOperationParcel` did a bare update and
`OperationParcel` had no version. If a supervisor changed the job meanwhile,
the stale queued edit silently won.

`OperationParcel` gains a `version Int @default(0)`, bumped on every mutation.
The write path is now optimistic-locked end to end:

```
capture line.version at enqueue → outbox item.ifMatch
   replay: fetchSender / sw.js send `If-Match: <version>`
   route reads If-Match → markOperationParcel(…, expectedVersion)
   version-checked updateMany(where {id, version: expectedVersion}, {…, version: {increment:1}})
     mismatch → throw staleData(409 STALE_DATA, { currentVersion, currentStatus })
   outbox on 409: PARK the item (conflict set) — never dropped, never re-sent
   → useOfflineSync.conflicts → OfflineConflictBanner: keep-mine / take-server
```

Happy path (versions match) is invisible — no prompt. `keep-mine` re-sends at
the server's current version so the operator's edit wins deliberately;
`take-server` discards the queued edit. Online direct edits without an
`If-Match` skip the check (unchanged).

## Files

| File | Role |
|---|---|
| `prisma/schema/agriculture.prisma` + migration | `OperationParcel.version Int @default(0)` |
| `src/app-layer/usecases/field-operation.ts` | `markOperationParcel(expectedVersion)` — version-checked `updateMany`, 409 `staleData`, returns new `version` |
| `.../field-operations/[taskId]/parcels/[lineId]/route.ts` | reads `If-Match` → `expectedVersion` |
| `src/lib/offline/outbox.ts` | `OutboxItem.ifMatch` + `OutboxConflict`; `enqueue` carries `ifMatch` |
| `src/lib/offline/sync.ts` | `fetchSender` sends `If-Match`, parses 409 body; `flushOutbox` skips parked conflicts, parks on 409 (`conflicts` count) |
| `public/sw.js` | SW flush in lockstep — `If-Match`, skip conflicts, park on 409 |
| `src/lib/offline/use-offline-sync.ts` | `conflicts` + `resolveConflict(keep-mine/take-server)`; `pending` excludes conflicts; online 409 parks too |
| `src/components/offline/OfflineConflictBanner.tsx` | the resolution UI (en + bg) |
| `src/components/offline/OfflineFieldPanel.tsx` | captures `line.version` as `ifMatch`; mounts the banner |

## Decisions

- **`updateMany` with `version` in WHERE, not a read-then-`update`.** Race-safe:
  a concurrent write between the read and the write makes `count === 0`, which
  is treated as the same 409 (re-read for the current version). A pre-read check
  also short-circuits the common case with a clearer error body.
- **409 is a NON-transient outbox state, distinct from the 429/5xx/4xx branches.**
  It's neither retried (a blind retry 409s again or clobbers once versions
  align) nor dropped (that would lose the operator's work). The item is parked
  with the server state until the operator chooses.
- **`ifMatch` is transport metadata** (an `If-Match` header, mirroring
  `Idempotency-Key`), not part of the request body schema.
