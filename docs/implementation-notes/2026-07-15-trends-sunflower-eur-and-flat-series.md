# 2026-07-15 — Trends: BG oilseed prices in EUR + flat-series chart fix

**Commit:** `<pending>` fix(trends): BG oilseed prices are EUR; fix flat-series chart render

## Context

Two defects on the Trends → Prices tab, reported against the sunflower view:

1. **The Greece (EL) sunflower chart rendered broken** — a solid black fill and
   a garbled axis. Root cause: the EC feed reports EL sunflower as a *constant*
   400 EUR/t (19 weekly points, all 400, with a 6-month reporting gap). A
   constant series gives `computeYDomain` → `{minY: 400, maxY: 400}`, so
   `buildYScale` built a degenerate `[400, 400]` domain — every point mapped to
   the same y, collapsing the chart's coordinate system (the area fill became a
   solid block, the flat line + axis read as "broken").

2. **The "Цена BG (официална)" card showed a bare number** with no currency.

## Changes

- **`lib/market/price-parse.ts`** — `oilseedCurrencyForRegion('BG')` now returns
  **EUR**, not BGN. Bulgaria adopted the euro on 2026-01-01, so the EC oilseeds
  "national currency/ton" for BG is EUR. The stored values were already
  EUR-magnitude (sunflower ~512, not ~260), and the BG line shows no
  January step, confirming the numbers were EUR all along — only the label was
  stale. `unit` is derived as `${currency}/t`, so it becomes `EUR/t`
  automatically. (BG cereals were already EUR; only BG oilseeds were mislabelled.)

- **`components/trends/trends-helpers.ts`** — `groupSeriesByUnit` →
  **`groupSeriesByRegionUnit`**: charts are now grouped by
  `(region, currency, unit)`, not just `(currency, unit)`. Now that BG and EL
  are both EUR/t they would otherwise merge onto one chart; splitting by region
  keeps each member state on its own chart (the pre-existing per-region layout).
  A region's own stages at the same unit still overlay in one group. Added
  `formatPriceWithCurrency(value, currency)`.

- **`components/trends/PricesTab.tsx`** — the BG stat tile renders
  `formatPriceWithCurrency(price, series.currency)` → "512 EUR".

- **`components/ui/charts/layout.ts`** — `buildYScale` pads a zero-range domain
  (`minY === maxY`) into a symmetric band (±5% of the value, or ±1 at zero) so a
  flat series renders a mid-chart line with a normal fill instead of a collapsed
  black block. Benefits every chart, not just Trends.

## Prod data migration (one-off)

The pull job sets a series' `currency`/`unit` only at CREATE time and never
updates them, so existing BG sunflower series stay `BGN` until relabelled:

```sql
UPDATE "MarketPriceSeries" SET currency='EUR', unit='EUR/t'
WHERE region='BG' AND currency='BGN';   -- the 2 BG sunflower (oilseed) series
```

Followed by flushing the `trends:prices:*` Redis keys (6h cache). Values are
unchanged — only the label.

## Decisions

- **Relabel, don't reconvert.** The stored BG numbers are already EUR-magnitude;
  changing `BGN → EUR` is a pure label correction, no arithmetic.
- **Group by region, not currency.** Keeps the operator's familiar one-chart-
  per-country layout even as currencies converge on EUR across the EU.
- **Fix the degenerate domain in the shared primitive**, not the Trends tab — any
  constant series (a flat KPI, a single-value week) hit the same collapse.
