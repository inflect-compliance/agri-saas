# 2026-07-24 — Stock-ledger integrity hardening (chain ordering, both-halves reconcile, conservation)

**Commit:** `<sha>` fix(inventory): monotonic chain order, both-halves reconcile, negative-balance flagging

Three correctness fixes on the append-only food-safety stock ledger. The
ledger is a regulatory spine (product lot → field → consumed quantity), so
each fix is DETECTION-first and preserves the single-writer triggers, the
advisory lock, the idempotency dedup, canonical decimal hashing, the
derived on-hand cache, and the traceability walk.

## 1. Chain ordering bug (flag 1, HIGH) — fork (a), hardened

`appendStockTransaction` picked the chain tail with `orderBy createdAt desc`
but never set `createdAt` on INSERT, so it defaulted to the row's
`CURRENT_TIMESTAMP` = the transaction's START time — captured BEFORE the
per-tenant advisory lock. The post-lock `new Date()` fed only `occurredAt`.
Under concurrent appends with staggered pre-lock work, transaction-start
order could disagree with the lock-serialized LINK order, so `createdAt`
ordering (writer tail-pick + `verifyStockChain`) diverged from the actual
chain and faked a "DRIFT"/fork.

**Fix — fork (a), mirroring the AuditLog writer** (`audit-writer.ts` captures
`now` after the lock and inserts it as `createdAt`): capture the append
timestamp AFTER the advisory lock and set it EXPLICITLY as `createdAt`.
We went slightly beyond the raw mirror to close a residual same-millisecond
gap: the timestamp is CLAMPED strictly above the tail's `createdAt` (`+1ms`),
so the order is *strictly monotonic* per chain even for two appends in the
same millisecond. This matters because the tiebreak (`id`) is a
non-monotonic `cuid`; plain post-lock `createdAt` still forks if the
second-inserted row draws a smaller `id`. Safe to nudge — `createdAt` is
NOT part of the entry hash (only `occurredAt` is), so it is purely the
ordering key both the writer and verifier agree on.

Fork (b) — a `sequence @default(autoincrement())` column — was rejected:
the codebase has no autoincrement precedent, and a `BIGSERIAL` backfill
populates existing rows in physical (not chain) order, which would need a
careful `row_number() OVER (ORDER BY createdAt)` migration on live
regulatory data. The monotonic-clamp gives the same total-order guarantee
with zero migration.

No schema change; `verifyStockChain` + the tail-pick already order by
`createdAt` — they are now correct.

## 2. Reconcile BOTH halves on demand (flag 4)

The daily job already ran both `verifyStockChain` and `verifyLotBalances`,
but the on-demand admin `reconcileStockLedger` ran only the chain. So
"verified intact" could hide a drifted (or negative) on-hand cache. Now it
runs both and returns `StockLedgerReconciliation` (`StockChainVerification`
+ `balances`). The audit `detailsJson.data`, the API response, the history
DTO, and the admin **Ledger Integrity** page all carry the balance verdict
— a new "Balances" history column + a distinct amber "Balance drift" hero
state when the chain is intact but the cache is not. The `ag.operation`
metric success (which drives the `AgLedgerReconciliationDrift` SLO alert)
is now keyed on BOTH halves being clean.

## 3. Negative / conservation (flag 3)

`verifyLotBalances` gained a conservation check: any lot whose
AUTHORITATIVE ledger `SUM(quantityDelta)` is below zero is flagged in a new
`negative[]` list, and a top-level `healthy` flag folds cache-drift +
negative-on-hand together (`balanced` still means cache-consistency alone).
A negative on-hand is a distinct anomaly the cache can faithfully mirror,
so `balanced` alone would silently pass it — `healthy` does not.

**Write policy — fork decision:**
  - **`adjustStock`: reject-and-flag.** A manual count correction must never
    create physically-impossible negative stock. An opt-in
    `disallowNegative` guard on `appendStockTransaction` (checked under the
    advisory lock, so read-then-write is race-free) rejects a correction
    that would drive on-hand below zero with `badRequest('negative_on_hand')`.
  - **The FEFO spray CONSUMPTION: record truthfully + flag.** The spray
    HAPPENED, so the ledger records the true consumption for traceability
    even when it exceeds tracked stock. Clamping would falsify the
    food-safety record; splitting across FEFO lots would break the single
    stable-key idempotency this path relies on (a PRESERVE constraint). An
    over-draw is surfaced at the write (`note: 'over_consumption'` + a warn
    log) and durably flagged by `verifyLotBalances` at reconciliation.

## Files

| File | Role |
| --- | --- |
| `src/lib/inventory/stock-ledger.ts` | monotonic post-lock `createdAt`; `disallowNegative` guard; `verifyLotBalances` negative check + `healthy`; `StockLedgerReconciliation` type. |
| `src/app-layer/usecases/inventory.ts` | `adjustStock` sets `disallowNegative`; spray over-consumption note/warn; `reconcileStockLedger` runs both halves; history DTO carries balance status. |
| `src/app-layer/jobs/reconcile-inventory-ledgers.ts` | drift keyed on `healthy`; logs negative lots; `negativeCount` per tenant. |
| `src/app/api/.../admin/ledger-reconciliation/route.ts` | response carries the balance half. |
| `src/app/.../admin/ledger-integrity/LedgerIntegrityClient.tsx` | Balances column + balance-drift hero + toast. |
| `messages/{en,bg}.json` | balance-half strings. |

## Decisions

- **Detection over prevention for operational reality.** The spray path
  keeps recording the truth; conservation is enforced by flagging, not by
  falsifying or dropping a real movement. Prevention (`disallowNegative`) is
  applied only where an impossible state has no legitimate business meaning
  (manual adjustment).
- **`createdAt` is an ordering key, not a business timestamp.** Because it
  is excluded from the hash, clamping it for strict monotonicity is sound
  and needs no re-hashing or migration.
