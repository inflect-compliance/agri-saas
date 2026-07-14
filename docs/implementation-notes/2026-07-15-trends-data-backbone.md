# 2026-07-15 — Market-price trends data backbone

**Commit:** _(API + job + schema only — no UI in this PR)_

## Design

A GLOBAL, tenant-agnostic price cache feeding a future trends chart. Three
independent sources land in the same two tables; the read API groups by
`(source, region)` so a chart can split lines by unit/currency.

```
                      ┌──────────────── market-prices-pull (BullMQ) ───────────────┐
 EC AGRI-food API ───▶│ pullEc  (weekly)   cereals + oilseeds → normalised items   │
 Alpha Vantage    ───▶│ pullAv  (daily)    WHEAT/CORN → items (skipped w/o key)     │
 ExchangeListing  ───▶│ pullListings (wk)  k-anon weekly median → items            │
                      └──────────────┬──────────────────────────────────────────────┘
                                     ▼ persistItems (idempotent upserts)
                   MarketPriceSeries (source,commodity,region,stage) 1─* MarketPricePoint (date,price,meta)
                                     ▲
        GET /api/t/[slug]/trends/prices?commodity=&range=  ── getPriceTrends (6h Redis cache)
```

Both tables are GLOBAL (no `tenantId`, no RLS) — the same class as
`SoilSample` / `CadastreArchive`. They carry public reference data and a
k-anonymised cross-tenant aggregate, identical for every tenant. Because
they have no `tenantId` they are auto-excluded from `TENANT_SCOPED_MODELS`
and every RLS/tenant-index guardrail; the ordinary `prisma` singleton (which
runs as the DB superuser, matching `superuser_bypass`) reads every tenant's
ACTIVE listings and writes the cache directly — no per-tenant context needed.

### Verified EC AGRI-food endpoint shapes

Smoke-tested from the production VM (the sandbox cannot reach the host). Base
default `https://www.ec.europa.eu/agrifood/api` (override `EC_AGRIFOOD_BASE_URL`).

- **Cereals** — `GET /cereal/prices?memberStateCodes=BG,RO,EL&productCodes=BLTPAN,MAI,ORGFOUR&years=<yyyy>`.
  Record keys: `memberStateCode, memberStateName, beginDate("dd/mm/yyyy"),
  endDate, price("€178,00" — EUR, COMMA decimal), unit("TONNES"), weekNumber,
  productName, marketName, stageName, referencePeriod`. Responses are HUGE
  (~4.7 MB per member-state-year) → ALWAYS filter by productCodes +
  memberStateCodes. Product-code map (from `GET /cereal/products`):
  wheat→`BLTPAN`, maize→`MAI`, barley→`ORGFOUR`. We request ONE product code
  per call because the response carries `productName`, NOT a product code —
  a single-code request lets every record map unambiguously to one slug.
- **Oilseeds (sunflower)** — `GET /oilseeds/prices?memberStateCodes=BG&years=<yyyy>`
  (NOTE the singular `/oilseed/` 404s). **DIFFERENT record keys:** `product`
  (not productName), `market` (not marketName), `marketStage` (not stageName),
  `marketingYear` (not referencePeriod), `price("€512.00" — DOT decimal!)`,
  `unit("national currency/ton")`. Filter `product === "Sunflower seed"`.
- **Price parser** (`parseEuroPrice`, shared + unit-tested): handles BOTH
  `"€178,00"` and `"€512.00"` by inspecting the LAST separator — comma ⇒
  European (dots=thousands, comma→decimal), dot ⇒ dot-decimal (strip commas).
  Non-numeric (`":"`, `""`) → `null` ⇒ the caller skips the row.
- **Currency/unit is per-series and load-bearing** — we do NOT normalise
  across sources: cereals `currency:'EUR', unit:'EUR/t'`; oilseeds resolve the
  currency from the member state (`BG→BGN, RO→RON, EL/EU→EUR`) and store
  `unit:'<CUR>/t'`. The `€` glyph on oilseed prices is a MISLEADING generic
  prefix — we trust the region, not the glyph.
- **EU average** — we simply add `EU` to `memberStateCodes`; if the API
  returns `memberStateCode:'EU'` records they become a `region:'EU'` series,
  otherwise the source degrades to nothing. (EU-aggregate availability is
  verify-later — not confirmed in the smoke test.)

### Alpha Vantage (NOT live-verified)

No free key in this environment, so `alpha-vantage-client.ts` is built to the
DOCUMENTED shape `{ data:[{date,value}] }` (USD, region GLOBAL, label
"Reference (Alpha Vantage)"), `function=WHEAT|CORN&interval=monthly`. It is
fully isolated behind the client so a paid futures feed can replace it later.
Throttling (HTTP 429 OR a `Note`/`Information` body) surfaces as
`AlphaVantageRateLimitError`; the job backs off linearly (1 s, 2 s) and the
25 req/day free budget is respected trivially (2 requests/run). Skipped
entirely when `ALPHA_VANTAGE_API_KEY` is unset.

### k-anonymity floor (own-listings index)

`computeListingsMedianIndex` (pure, unit-tested) groups ACTIVE listings by
`(commodity, priceCurrency)` and emits a weekly median ONLY for groups drawing
on ≥ 3 DISTINCT tenants (`LISTINGS_K_ANON_FLOOR`). The stored point carries
only `{ count }` in `meta` — never a listing id or tenant id. All exchange
listings are per-tonne, so `unit = '<currency>/t'` and there is no unit
dimension to group on beyond currency.

## Files

| File | Role |
|---|---|
| `prisma/schema/market.prisma` | `MarketPriceSeries` + `MarketPricePoint` GLOBAL cache models |
| `prisma/migrations/20260715120000_market_prices/migration.sql` | Hand-written migration (matches Prisma naming; validated against the test DB) |
| `src/lib/market/price-parse.ts` | Shared EUR price parser + oilseed currency-from-region |
| `src/lib/market/ec-agrifood-client.ts` | EC cereals + oilseeds HTTP client (pure, injectable fetch) |
| `src/lib/market/alpha-vantage-client.ts` | Alpha Vantage commodities client (documented shape; rate-limit error) |
| `src/lib/market/listings-index.ts` | Pure k-anon weekly-median computation |
| `src/app-layer/jobs/market-prices-pull.ts` | The pull job (EC/AV/listings, idempotent upserts, injectable db) |
| `src/app-layer/jobs/{types,executor-registry,schedules}.ts` | Payload type, executor registration, one weekly all-sources schedule |
| `src/app-layer/schemas/trends.schemas.ts` | Zod query schema (commodity, range) + range lookback map |
| `src/app-layer/usecases/trends.ts` | Read usecase — grouped series + 6h Redis cache |
| `src/app/api/t/[tenantSlug]/trends/prices/route.ts` | Tenant-authed read route |
| `src/env.ts`, `deploy/env.prod.example` | `EC_AGRIFOOD_BASE_URL` + `ALPHA_VANTAGE_API_KEY` (both optional) |

## Decisions

- **No RLS/guardrail-list edits.** The spec assumed `SoilSample` is named in an
  explicit global-cache exception list; it is not. Every RLS/tenant-index
  guardrail derives its inventory from models that HAVE a `tenantId` field, so
  a table without one is auto-excluded — the correct precedent is "add no
  `tenantId`, add no list entries". The only guardrail that inspects all
  models is schema-index Layer B (FK index), satisfied by
  `@@index([seriesId])` on `MarketPricePoint`.
- **Currency/unit stored per-series, never normalised.** A BGN listings median
  and a EUR EC cereal price must not share a Y axis; the read API groups by
  `(source, region)` and returns each series' own unit/currency so the chart
  splits them.
- **Series upsert is find-or-create via a prefetched map, not `prisma.upsert`.**
  The natural key includes the nullable `stage`, which Prisma's `whereUnique`
  cannot express. The job prefetches the whole (bounded) series catalog once
  into an in-memory map, then creates missing series — keeping the write loop
  N+1-free (the query-shape guardrail bans reads-in-loops, not writes). Points
  use `prisma.upsert` on the non-null `(seriesId, date)` key.
- **Duplicate (series, date) tuples are averaged** before upsert (EC returns
  multiple markets per region/stage/week) so write order never changes the
  stored value — deterministic + idempotent.
- **Injectable `db` on the job.** Locally only the direct test DB (port 5434)
  is reachable; the app singleton's `DATABASE_URL` points at PgBouncer. Making
  the DB client an injectable dep lets the integration test drive the job
  against the test-DB client and keeps the job unit-testable.
- **One weekly all-sources schedule, not three per-source entries.** The spec
  asked for EC+listings weekly and AV daily as separate schedules, but the repo
  enforces a hard UNIQUE-schedule-name contract (`bullmq-scheduler.test.ts`), so
  a single job name cannot appear on three schedule entries. A single weekly
  `market-prices-pull` run (defaultPayload `{}` → all sources) satisfies every
  cadence: EC + listings are weekly indices, and Alpha Vantage commodities are
  MONTHLY-granularity so a weekly refresh is more than enough (2 AV requests/week
  ≪ 25/day budget). The `source` payload field still supports manual/targeted
  single-source runs.
- **Migration applied by hand to the local test DB.** The shared local test DB
  had a pre-existing FAILED migration (`20260613..._ag_feature1_spray_map`)
  blocking `migrate deploy`, and Prisma (correctly) refuses `migrate reset`
  from an AI agent without explicit user consent. The new migration SQL was
  validated by applying it directly (it created cleanly); on a fresh CI DB the
  whole chain replays normally.
