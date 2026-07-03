# 2026-07-03 — Cross-tenant agriculture Exchange (backend foundation)

**Commit:** `<pending> feat(exchange): cross-tenant marketplace backend`

## Design

A cross-tenant marketplace where farms post SELL/BUY offers and others
browse + inquire. This **deliberately breaks the one-tenant-per-row rule**:
the whole point is that tenants read each other's rows.

```
GLOBAL tables (no tenantId, no RLS)          Cross-tenant safety
  ExchangeListing  ─┐                          lives ENTIRELY in the
  ExchangeInquiry  ─┘ (listingId FK, cascade)  usecase layer:
                                                  ctx.tenantId === sellerTenantId

repositories/exchange.ts   reads are GLOBAL (no tenantId filter) — the
                           documented exception to the repo rule
usecases/exchange.ts       the ONLY cross-tenant write guard; sanitizes
                           public free text; emits audit events
lib/geo/bulgaria-regions.ts  28 oblasti (code/bilingual name/centroid)
public/geo/bg-oblasti.geojson  28 ADM1 polygons (geoBoundaries, CC-BY-4.0)
```

Because `ExchangeListing`/`ExchangeInquiry` have no `tenantId` column, the
DMMF RLS auto-enroller (`rls-middleware.ts`) never adds them to
`TENANT_SCOPED_MODELS` — reads run global, and the RLS guardrails skip them
(same class as `Unit`/`Framework`). `app_user` gets table privileges via the
schema's `ALTER DEFAULT PRIVILEGES`, and with no RLS that's full global
access — the intended behaviour. The listing↔inquiry FK cascade is the only
referential integrity; ownership FKs (`sellerTenantId`/`inquirerTenantId`)
are **plain `String` columns**, not Prisma `@relation`s, to keep the tables
decoupled/global and to keep the FK-index guardrail from forcing tenant
composites.

## Files

| File | Role |
|---|---|
| `prisma/schema/exchange.prisma` | NEW — `ExchangeListing` + `ExchangeInquiry` (global) |
| `prisma/schema/enums.prisma` | +`ExchangeSide`/`ExchangeListingStatus`/`ExchangeInquiryStatus`; +`EXCHANGE` on `ModuleKey` |
| `prisma/migrations/20260703120000_add_exchange/` | NEW — enums + tables + indexes + `ModuleKey ADD VALUE` |
| `src/lib/geo/bulgaria-regions.ts` | NEW — typed 28-oblast catalogue + `regionByCode` + options |
| `public/geo/bg-oblasti.geojson` (+`README.md`) | NEW — 28 ADM1 polygons, geoBoundaries CC-BY-4.0 |
| `src/app-layer/repositories/exchange.ts` | NEW — global (non-tenant-filtered) Prisma queries |
| `src/app-layer/usecases/exchange.ts` | NEW — cross-tenant write guard + sanitize + audit |
| `src/lib/modules.ts` / `src/lib/entitlements.ts` | register `EXCHANGE` (min-plan `FREE`) |

## Decisions

- **`EXCHANGE` min-plan is `FREE`** — network-effect product; gating browse
  behind a paid tier would strangle the liquidity the marketplace needs.
- **Reads are global by design.** The repository is the one place that
  intentionally omits the `tenantId` filter; the isolation guarantee moves
  up to the usecase (`ctx.tenantId === listing.sellerTenantId` on every
  write). Documented loudly in both files so it isn't "fixed" later.
- **Region geo is bundled static + a typed module**, no DB table / no runtime
  fetch. `regionCode` === geojson `shapeISO`; `regionName`/`lat`/`lon` on a
  listing are DERIVED from `regionByCode` in the usecase, so the geo data
  has a single source of truth and a listing can't carry an unknown region.
- **geoBoundaries over yurukov/Bulgaria-geocoding** — the former is
  explicitly CC-BY-4.0 (redistribution-clean); the latter's license is
  unstated.
- **Plain-`String` ownership FKs, real `@relation` only for listing↔inquiry.**
  Keeps the tables global/decoupled and sidesteps the FK-index guardrail's
  tenant-composite expectation while still giving inquiries referential
  integrity + cascade delete.
- **Public free text is sanitized, not encrypted** (`commodity`,
  `description`, `sellerDisplayName`, inquiry `message`) — every tenant reads
  it, so it must be XSS-safe but is not confidential.
