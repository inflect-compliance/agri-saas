# 2026-06-13 — Inventory ledger + stock-deduction on spray completion

**Commit:** `<sha> feat(agriculture): inventory ledger + stock-deduction`

## Design

The second deferred Feature-1 candidate. Adds the inventory spine
(`InventoryLot`) + an append-only, hash-chained `StockTransaction`
ledger, plus a focused journal (`LogEntry` + `LogQuantity`). Completing
a spray line turns the job into a compliant, inventory-accurate record.

```
markOperationParcel(line, DONE)            [field-operation usecase]
        │  (transition into DONE only; un-complete does NOT reverse)
        ▼
recordInputApplication(db, ctx, line)      [inventory usecase, same tx]
        │  resolveEnabledModules(db)  ── WP-2 gate (non-throwing)
        ├── JOURNAL on  → LogEntry(INPUT_APPLICATION) + LogQuantity(applied)
        └── INVENTORY on → FEFO lot → appendStockTransaction(CONSUMPTION −qty)
                                              │
                              [stock-ledger.ts: the ONE writer]
                              advisory-lock → previousHash → entryHash →
                              INSERT → refresh InventoryLot.quantityOnHand
```

**The ledger is the food-safety spine.** `StockTransaction` is
append-only: a per-tenant SHA-256 hash chain (the inventory twin of the
`AuditLog` chain, reusing `canonicalJsonStringify`), a DB trigger that
blocks UPDATE/DELETE (`IMMUTABLE_STOCK_LEDGER`), and a
`no-direct-stock-writes` guardrail so every append flows through the one
writer. `quantityOnHand` is a denormalised cache recomputed from the
ledger sum inside the same advisory-locked step — never client-set.

**Consumed quantity.** A RATE dose (L/ha) × parcel `areaHa`; a flat dose
is taken as-is. Phase-1 simplification: no cross-unit conversion (the
product's default unit is assumed to match the rate numerator), and the
FEFO lot may go negative on a tracking shortfall (an honest ledger; the
reorder signal + an ADJUSTMENT close the gap). If the product has no lot
with stock, the journal record still stands and the consumption is
skipped (`note: 'no_lot_available'`).

**WP-2 integration.** The gate reuses the module-gating feature: a
non-throwing `resolveEnabledModules` read on the same `db` handle (no
nested transaction) decides whether to emit. INVENTORY off → completion
behaves exactly as Feature 1 (no-op). Default-on means existing tenants
get deduction once they create lots — and a no-op until they do.

## Files

| File | Role |
| --- | --- |
| `prisma/schema/inventory.prisma` | `InventoryLot` + immutable `StockTransaction`. |
| `prisma/schema/journal.prisma` | `LogEntry` + `LogQuantity` (focused journal). |
| `prisma/schema/enums.prisma` | `StockTransactionType`, `LogEntryType`, `LogEntryStatus`; `Item.reorderLevel`. |
| `prisma/migrations/20260613160000_ag_inventory_ledger/` | Tables, indexes, FKs, RLS trio ×4, immutability trigger. |
| `src/lib/inventory/stock-hash.ts` | Canonical SHA-256 over the ledger field set (reuses audit canonicaliser). |
| `src/lib/inventory/stock-ledger.ts` | THE writer — `appendStockTransaction` + `verifyStockChain`. |
| `src/app-layer/repositories/InventoryRepository.ts` | Lots: list/get/createLot/getFefoLot/lotLedger. |
| `src/app-layer/repositories/JournalRepository.ts` | `createLogEntry` (+ nested quantities). |
| `src/app-layer/usecases/inventory.ts` | listLots/getLot/createLot/receive/adjust + `recordInputApplication`. |
| `src/app-layer/usecases/catalog.ts` | `createItem` (the catalog write). |
| `src/app-layer/usecases/field-operation.ts` | Wires `recordInputApplication` on DONE. |
| `src/app/api/t/[tenantSlug]/inventory/lots/**` | List/create/detail/receive/adjust (gated INVENTORY). |
| `src/app/.../inventory/InventoryClient.tsx` | Lots list + create modals + lot ledger/movement. |
| `tests/guardrails/no-direct-stock-writes.test.ts` | The "single writer" structural ratchet. |

## Decisions

- **One writer, enforced three ways.** App layer (`appendStockTransaction`),
  DB trigger (UPDATE/DELETE block), and a structural guardrail. The hash
  chain is worthless if a second code path can insert an unchained row,
  so the guardrail bans `db.stockTransaction.{create,update,delete}`
  everywhere except `stock-ledger.ts`.

- **Runs inside the caller's transaction.** Unlike the audit writer
  (own `$transaction` on the global client), the stock writer takes the
  caller's `PrismaTx` so the CONSUMPTION + lot-cache refresh are atomic
  with the OperationParcel update. The advisory lock
  (`hashtext('stock:'||tenantId)`) is a distinct namespace from the
  audit chain's lock.

- **Focused journal, genealogy deferred.** `LotLink` (split/merge),
  TRANSFER from/to-location columns, and the Equipment/Planting/File
  journal links from the draft are out of scope — the spray-completion
  path needs none of them. Cut cleanly so the re-add is additive.

- **Emit only on the transition into DONE.** `fromStatus !== 'DONE'`
  guards against a PENDING↔DONE toggle double-charging. Un-completing
  does not auto-reverse (append-only — post an ADJUSTMENT); re-completing
  re-emits, which is a genuine re-application claim.

- **`createItem` lives in `catalog.ts`, gated at the route.** The read
  path (spray form) stays open; only the POST asserts INVENTORY.
