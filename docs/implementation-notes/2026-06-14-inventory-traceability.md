# 2026-06-14 — Inventory lot genealogy + traceability + low-stock alerts

**Commit:** `feat(inventory): lot genealogy, harvest→lot wiring, traceability walk, low-stock job`
**Branch:** `feat/inventory` (built on `feat/journal`).

## Design

Phase-1 inventory (#13) already shipped the spine: `InventoryLot`, the
append-only hash-chained `StockTransaction` ledger (single writer
`stock-ledger.ts`, immutability trigger, `no-direct-stock-writes`
guardrail), FEFO consumption, and the spray-completion wiring
(`OperationParcel` DONE → CONSUMPTION + `INPUT_APPLICATION` LogEntry). This
change adds the **traceability** layer on top.

```
   RECEIPT          CONSUMPTION (spray)        HARVEST_IN
 supplier ──▶ inputLot ──▶ (field/parcel) ──▶ harvestLot
                   │            ▲                  ▲
                   └── LotLink DERIVATION edge ────┘   (genealogy)
```

**`LotLink`** is the new model — a directed, append-only genealogy edge
(`parentLot` was consumed/used to produce `childLot`). It is the second
DB-immutable table (BEFORE UPDATE/DELETE trigger `IMMUTABLE_LOT_GENEALOGY`,
mirroring the ledger) and the second table funnelled through the single
sanctioned writer (`appendLotLink` in `stock-ledger.ts`), so the
`no-direct-stock-writes` guardrail now covers both. Not hash-chained — it's
a graph, not a sequence — but self-edge-rejecting and idempotent on
`(tenantId, parentLotId, childLotId)`.

**Harvest → lot.** A HARVEST `LogEntry` may carry an optional `harvest`
payload; `journal.createLogEntry` calls `inventory.recordHarvestLot` in the
SAME transaction (INVENTORY-module gated). It mints a HARVEST_IN lot of the
harvested item, posts the chained HARVEST_IN ledger entry (linked to the
entry), and — for the field harvested — creates a DERIVATION `LotLink` from
every input lot CONSUMED on that parcel. The harvest lot also records its
source parcel in `attributesJson.harvestedFromParcelId` so the field is
known even with zero inputs.

**Traceability walk** (`inventory.traceLot`). Bidirectional BFS over
`LotLink` (one query per level, never per-node): ancestors (up) +
descendants (down), each lot annotated with the fields it touched
(consumed-on parcels via `logEntry → operationParcel → parcel`, plus the
harvest source parcel). Answers the food-safety recall query both ways:
seed-lot → field → harvest-lot, and its inverse.

**Low-stock alerts.** `low-stock-monitor` BullMQ job (daily 09:00 UTC,
cross-tenant like `risk-appetite-jobs`): Σ on-hand per item (one grouped
query) vs `Item.reorderLevel`; below threshold → `LOW_STOCK` notification to
active OWNER/ADMIN members, deduped one-per-(item, recipient, day).

**Chain-verify twin.** `scripts/verify-stock-chain.ts` mirrors
`verify-audit-chain.ts` — walks every tenant's stock chain via the existing
`verifyStockChain`, exit 0/1/2. `npm run verify:stock-chain`.

## Files

| File | Role |
|------|------|
| `prisma/schema/inventory.prisma` | + `LotLink` model + `linksAsParent/Child` back-relations |
| `prisma/schema/enums.prisma` | + `LotLinkType` (DERIVATION/SPLIT/MERGE), + `LOW_STOCK` NotificationType |
| `prisma/schema/{auth,journal}.prisma` | back-relations (Tenant/User/LogEntry → LotLink) |
| `prisma/migrations/20260614194014_inventory_lot_genealogy/` | hand-authored (drift stripped): LotLink + RLS trio + immutability trigger + enum ADD VALUE |
| `src/lib/inventory/stock-ledger.ts` | + `appendLotLink` (single sanctioned LotLink writer) |
| `src/app-layer/repositories/InventoryRepository.ts` | + genealogy/harvest queries (batched, N+1-safe) |
| `src/app-layer/usecases/inventory.ts` | + `recordHarvestLot`, + `traceLot` |
| `src/app-layer/usecases/journal.ts` | HARVEST entries call `recordHarvestLot` in-txn |
| `src/lib/schemas/index.ts` | + `harvest` payload on `CreateLogEntrySchema` |
| `src/app/api/t/[tenantSlug]/inventory/lots/[lotId]/trace/route.ts` | GET trace |
| `src/app-layer/jobs/low-stock-monitor.ts` | the daily sweep |
| `src/app-layer/jobs/{types,executor-registry,schedules}.ts` | job registration (4 points) |
| `scripts/verify-stock-chain.ts` + `package.json` | chain-verify twin + `verify:stock-chain` |
| `THIRD_PARTY_NOTICES.md` | NEW — InvenTree (MIT) / OFBiz (Apache) ports + GPL concept-only boundary |

## Decisions

- **LotLink immutable but not hash-chained.** Genealogy is a DAG, not a
  total order — a per-tenant hash chain doesn't fit. Append-only via the DB
  trigger + single writer gives tamper-evidence enough for provenance; the
  ledger keeps the hash chain.
- **Single writer covers both tables.** `appendLotLink` lives in
  `stock-ledger.ts` so the existing `no-direct-stock-writes` ratchet
  (extended to `lotLink`) is the one place that enforces "append-only,
  single-writer" for the whole inventory-integrity surface.
- **Harvest field via `attributesJson`, not a new column.** The harvest
  lot's source parcel is recorded in `attributesJson.harvestedFromParcelId`
  rather than adding an `InventoryLot.harvestedFromParcelId` FK — it's
  provenance metadata read only by the trace, not a query axis, so it
  doesn't earn a column + index.
- **Genealogy auto-derived from consumption.** Rather than make the operator
  hand-pick parent lots, `recordHarvestLot` discovers them from the
  CONSUMPTION ledger on the harvested parcel (explicit `sourceLotIds` still
  accepted). The traceability story falls straight out of the data already
  captured by spray completion.
- **Migration hand-authored.** `migrate dev --create-only` injected the
  usual unrelated drift (FK churn, the `Parcel_geometry_gist` GiST drop,
  emailHash NOT NULL); only the LotLink + 2 enum changes were kept, then the
  RLS trio + immutability trigger appended (repo convention). `ALTER TYPE
  ADD VALUE 'LOW_STOCK'` runs fine in the migration transaction on PG16.
- **Low-stock reads cross-tenant with the privileged worker prisma**
  (mirrors `risk-appetite-jobs`); notifications dedupe via a date-bucketed
  `dedupeKey` and pre-filter already-sent keys so SSE isn't re-published.
