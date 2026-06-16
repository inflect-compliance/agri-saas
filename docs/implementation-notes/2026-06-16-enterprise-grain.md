# 2026-06-16 — Enterprise-grain (the large grain-producer persona)

**Commit:** `<sha>` feat(grain): schema foundation + tenant features + org portfolio + public API

## Design

The enterprise-grain layer turns the ag SaaS toward the large grain
producer: storage logistics, marketing contracts, harvest yield, and
per-activity cost accounting, rolled up across a portfolio of child
farms. It reuses, rather than reinvents, three existing subsystems — the
inventory ledger (bins + blending), the GRC field-encryption manifest
(commercial confidentiality), and the org hub-and-spoke fan-out (cross-
farm aggregation).

```
                          GRAIN module (ENTERPRISE min-plan)
                                      │
        ┌──────────────┬─────────────┼──────────────┬───────────────┐
        ▼              ▼             ▼              ▼               ▼
   Contract       YieldRecord     bins =        blending =      cost rollup
   (marketing)    (production)    Location       LotLink         LogEntry.cost +
   terms/pricing  valuationNotes  kind=BIN/      type=MERGE      StockTransaction.cost
   ENCRYPTED      ENCRYPTED       STORAGE        (ledger seam)   per planting/field/season
   volumeTonnes   grossTonnes     capacityTonnes
   PLAINTEXT      PLAINTEXT       + fill %
        └──────────────┴─────────────┴──────────────┴───────────────┘
                                      │  fanOutPerTenant (RLS per child)
                                      ▼
                    Org portfolio grain dashboard (across child farms)
                                      │
                                      ▼
                    Public OpenAPI catalog (grain DTOs → openapi.json)
```

**The plaintext/encrypted split is the load-bearing decision.** Grain
contracts hold the most commercially sensitive free text a producer
owns (negotiated terms, pricing basis) — those are encrypted at rest via
the Epic B manifest. But the magnitudes that the portfolio/cost/yield
rollups must `SUM()` in-DB (`volumeTonnes`, `pricePerTonne`,
`grossTonnes`, `costAmount`) stay plaintext Decimals — an encrypted
column cannot be aggregated. Sanitisation at the usecase boundary
protects every downstream renderer; encryption protects at rest; the
numerics stay queryable. All three hold simultaneously.

**Bins and blending are NOT a new subsystem.** A storage bin is a
`Location` with `kind in (BIN, STORAGE)` + `capacityTonnes`; the lots it
holds are ordinary `InventoryLot`s pointed at it via `locationId`.
Blending is a `MERGE` `LotLink` over the existing append-only ledger
seam (`appendStockTransaction` consume→produce + `appendLotLink`) — the
same genealogy the harvest path (`DERIVATION`) already uses, so the
traceability walk, immutability triggers, and no-direct-stock-writes
guardrail all apply for free.

## Files

| File | Role |
|---|---|
| `prisma/schema/grain.prisma` | `Contract` + `YieldRecord` (tenant-scoped, RLS trio) |
| `prisma/schema/agriculture.prisma` | `Location += kind (LocationKind) + capacityTonnes` |
| `prisma/schema/enums.prisma` | `LocationKind`, `ContractType`, `ContractStatus`, `ModuleKey += GRAIN` |
| `prisma/migrations/20260616071027_add_enterprise_grain` | tables + columns + RLS trio (drift-stripped) |
| `prisma/migrations/20260616071756_add_grain_module` | `ALTER TYPE ModuleKey ADD VALUE 'GRAIN'` |
| `src/lib/entitlements.ts` | `MODULE_MIN_PLAN.GRAIN = 'ENTERPRISE'` |
| `src/lib/modules.ts` | `ALL_MODULES`/labels/descriptions += GRAIN |
| `src/lib/security/encrypted-fields.ts` | manifest += `Contract.terms/pricingNotes`, `YieldRecord.valuationNotes` |
| `src/app-layer/usecases/contract.ts` | Contract CRUD (sanitise + audit + RLS) |
| `src/app-layer/usecases/yield-record.ts` | YieldRecord CRUD (+ `tPerHa` DTO) |
| `src/app-layer/usecases/grain-bin.ts` | bins = Location(BIN/STORAGE) + batched fill-% |
| `src/app-layer/usecases/grain-blend.ts` | `blendLots` (MERGE genealogy) + pure `blendQuality` |
| `src/app-layer/usecases/cost-rollup.ts` | per planting/field/season cost (batched, no N+1) |
| `src/app/api/t/[tenantSlug]/grain/**` | 8 GRAIN-gated routes |
| `src/app-layer/usecases/portfolio-grain.ts` | cross-farm grain aggregation (fanOutPerTenant) |
| `src/app/org/[orgSlug]/(app)/grain/page.tsx` | org portfolio grain dashboard |
| `src/lib/dto/grain.dto.ts` | OpenAPI-annotated grain response DTOs |

## Decisions

- **GRAIN is a module at ENTERPRISE min-plan, not a feature flag.** It
  rides the existing `(plan allows) ∧ (tenant enabled)` gate, so the
  whole surface is one `assertModuleEnabled(ctx, 'GRAIN')` per route +
  one nav gate — consistent with how PLANNING/CERTIFICATION are gated.
  The enum-value migration follows the `AG_SCHEME` precedent
  (standalone `ALTER TYPE … ADD VALUE`, drift stripped).
- **`Contract`/`YieldRecord` link OPTIONALLY to `Season`/`Planting`/
  `Location`.** A producer records yield against a field without a
  formal planting, or a marketing contract with no season; the FKs are
  nullable so the data model never forces ceremony. Composite
  `[xId, tenantId]` FKs keep the cross-tenant barrier.
- **Bin fill is a batched aggregate, never per-bin.** `listBins` does
  ONE `inventoryLot` query over all bin ids and reduces in memory —
  the index/query-shape guardrails (Layer C, D1) stay green.
- **Cost rollup sums TWO sources through `LogPlanting`.** Field-event
  cost (`LogEntry.costAmount`, the Ekylibre intervention-cost concept,
  reimplemented) + per-movement stock cost (`StockTransaction.costAmount`
  by `logEntryId`). The join walks `Planting → LogPlanting → LogEntry`
  + the stock txns on those entries, all in batched id-set queries.
- **Org aggregation reuses `fanOutPerTenant`.** Each child farm's grain
  totals come from bounded `aggregate`/`groupBy` queries run INSIDE
  `withTenantDb` (RLS as `app_user`) — no cross-tenant leakage, no
  `runInGlobalContext` for business rows. Only plaintext numeric columns
  are summed (encrypted columns can't be aggregated, by design).
- **Licence hygiene.** Ekylibre (AGPL) cost-accounting and OFBiz lot
  genealogy informed the CONCEPTS only — both reimplemented clean-room.
  No proprietary checklist or GPL/AGPL source was copied.
