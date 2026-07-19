# 2026-07-19 — Rent roll: unit-aware totals + the payment leg

**Commit:** `<pending>` feat(rent): unit-aware rent roll + lease payments + export gating

## Design

Roadmap prompt B of 3. Three changes, one theme — the rent roll should mean
what it says.

1. **Unit-aware aggregation.** The roll summed кг into лв. `getRentRoll` now
   groups by **(lessor × unit)** and returns season totals as an array of
   `{unit, total, paid, outstanding}`; the card, PDF and CSV render each unit
   separately („12 300 лв · 4 200 кг"). The `array_agg(... ORDER BY createdAt)[1]`
   latest-unit trick — which stamped one unit on a blended sum — is gone.
2. **The payment leg.** A new `LeasePayment` model records rent actually
   settled per season, so the roll answers *"who hasn't been paid"* instead of
   only *"what is owed"*.
3. **Export gating.** The PDF is now gated on `PDF_EXPORTS` client-side
   (`UpgradeGate`) **and** server-side (`requireFeature`), matching every other
   PDF route.

## The payments fork — decision: BUILD (option a)

The alternative was to rename the surface to a register and drop the rent-roll
framing. Building won because:

- **It's the question the page exists to answer.** A Bulgarian farm pays annual
  rent to dozens or hundreds of landowners; "who is still unpaid" is a core
  seasonal workflow, not a finance nicety. A register that can't answer it is
  the thing the rename would have been apologising for.
- **The cost was bounded and templated.** RLS is a copy-paste block from the
  `ParcelLease` migration; the guardrails (`rls-coverage`,
  `schema-index-coverage` Layer A/B/C, `usecase-test-coverage`) auto-discover a
  new model, so nothing could be silently forgotten.

Scope kept deliberately minimal: `{seasonYear, amountPaid, unit, paidAt, note}`
— a settlement ledger, not an invoicing module. Payments default to the lease's
own canonical unit so **rent settled in grain never books against a money
obligation**.

## Dimensional decisions

- **Rows are per (lessor × unit).** Each lease has exactly one unit, so the rows
  *partition* the leases — summing area or lease counts across rows never
  double-counts. `lessorCount` counts **distinct** lessors, not rows (a lessor
  with two units is still one lessor).
- **Canonical units at write time.** `rentUnit` now stores the canonical value
  the roll groups by; `rentUnitRaw` preserves what the operator typed.
  `canonicalRentUnit` folds aliases („лв./дка", "lv/dka", „ЛВ / ДКА") onto
  `лв/дка` / `кг/дка`; anything unrecognised keeps its own bucket rather than
  being coerced.
- **Why a new `rent-units` module and not `@/lib/units/unit-conversion`:** that
  catalog is the physical dose-math layer (AREA/VOLUME/WEIGHT/…, slug keys like
  `kg-per-dca`). Rent units carry a CURRENCY numerator, which has no dimension
  there. Rent gets its own small normaliser instead of bolting currency onto the
  dose catalog.
- **`ORDER BY rentTotal DESC` dropped** — it stopped being globally meaningful
  once rows are per-unit. Ordering is now (lessor, unit).

## Files

| File | Role |
|------|------|
| `src/lib/agro/rent-units.ts` | **New** — canonical units + `rentTotalSuffix` („лв/дка" → „лв"). |
| `src/app-layer/usecases/rent-roll.ts` | Groups by (lessor × unit); per-unit `totals`; payments LEFT JOIN → `paid`/`outstanding`; distinct `lessorCount`; `seasonYear`. |
| `src/app-layer/usecases/parcel-lease.ts` | `mapLeaseData` canonicalises `rentUnit`, preserves `rentUnitRaw`. |
| `src/app-layer/usecases/lease-payment.ts` | **New** — list / record / soft-delete + `LEASE_PAYMENT_RECORDED` audit. |
| `prisma/schema/agriculture.prisma` + `migrations/20260719120000_lease_payments/` | `rentUnitRaw`, `ParcelLease @@unique([id, tenantId])`, `LeasePayment` + RLS + indexes. |
| `src/app/api/.../leases/[leaseId]/payments/{route,[paymentId]/route}.ts` | **New** — GET/POST/DELETE. |
| `src/components/agro/LeasePaymentsPanel.tsx` | **New** — settlement log inside the lease edit modal. |
| `src/app/.../rent/RentClient.tsx` | Mounts the panel; „Неплатени" filter (per lessor × unit). |
| `src/components/ui/map/RentRollCard.tsx` | Per-unit totals + Outstanding; PDF link behind `UpgradeGate`. |
| `src/app-layer/reports/pdf/rent-roll.ts` | Per-unit summary; unit + Платено + Оставащо columns (widths rebalanced). Cyrillic font handling untouched. |
| `src/app/api/.../reports/rent-roll/route.ts` | `requireFeature(PDF_EXPORTS)`; CSV gains Платено/Оставащо (BOM preserved). |

## Decisions

- **CSV stays ungated**, PDF gated — the established `ReportsClient` policy.
- **Soft-delete for payments** so a mis-keyed settlement stops skewing the roll
  without erasing the audit trail.
- The „Неплатени" filter keys on **(lessor × unit)**: a lessor settled in лв but
  not in кг is still unpaid, and the filter says so.
