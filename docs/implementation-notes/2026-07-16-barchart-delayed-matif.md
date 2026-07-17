# 2026-07-16 — Barchart OnDemand: delayed MATIF futures source (trial)

**Commit:** `<pending>` feat(market): Barchart OnDemand delayed-futures source

## Why

The market-price trends previously refreshed **weekly** (EC AGRI-food open data
publishes weekly; Alpha Vantage commodities are monthly). Users wanted
near-real-time. A deep-research pass established the landscape:

- **Wheat, maize, rapeseed, soy complex, palm oil** have liquid exchange
  futures with a 10–15 min delayed feed. **Barley and sunflower do NOT** — they
  are physical/cash markets (best available is daily/weekly Black Sea FOB, e.g.
  APK-Inform, or the existing weekly EC feed).
- **Barchart OnDemand** is the one surveyed provider covering the EU benchmark
  **Euronext MATIF** (Paris: milling wheat, corn, rapeseed) plus CBOT + palm
  oil, on a 10–15 min delay, with a real JSON API.
- The binding constraint is **licensing, not API cost**: showing even *delayed*
  exchange prices to end users is "redistribution" — a per-exchange fee
  (~€164/mo delayed MATIF via Barchart; CBOT far dearer) **plus** the Euronext
  EMDA agreement. A fully-licensed multi-exchange live feed does **not** fit a
  €50/mo budget.

This change adds the **technical seam** so delayed MATIF wheat/corn can be
trialled once a key + licence are in place — it does not itself incur any cost
(the source is skipped when the key is unset).

## What

| File | Role |
| --- | --- |
| `src/lib/market/barchart-client.ts` | Pure-HTTP `getQuote` client (injectable fetch, timeout, rate-limit class) + `BARCHART_CONTRACTS` symbol→commodity map. NOT live-verified — built to the documented shape, isolated behind the module. |
| `src/app-layer/jobs/market-prices-pull.ts` | `pullBarchart()` — gated on `BARCHART_API_KEY`, maps quotes → `UpsertItem` (source `barchart`, region = exchange, EUR/t). Selectable via `payload.source === 'barchart'`. |
| `src/env.ts`, `deploy/env.prod.example` | Optional `BARCHART_API_KEY` (mirrors `ALPHA_VANTAGE_API_KEY` — unset ⇒ source skipped). |
| `src/app-layer/jobs/types.ts` | `MarketPricesPullPayload.source` gains `'barchart'`. |

**Default contracts:** only the two MATIF EUR/t contracts on the EXISTING Trends
commodities — milling wheat → `wheat`, corn → `maize`. Because the Trends charts
group by `(region, currency, unit)`, they render as a new **"MATIF" chart**
beside the EC BG/RO/EL lines with **no UI change**. Rapeseed / CBOT soy / palm
oil are one commented line away (they need a Trends-picker commodity added).

## Decisions / caveats (read before going live)

- **Symbols need confirming.** Roots (`ML` milling wheat, `EMA` corn) are
  best-known values, not live-verified. An unknown symbol simply returns no
  result (skipped, never a crash) — confirm against the real Barchart account.
- **Units are NOT normalised.** MATIF is EUR/t (clean). If CBOT is enabled it is
  US-cents/bushel and palm oil MYR/t — each lands on its own chart by design; no
  cross-source conversion is done.
- **Intraday scheduling — included, but dormant until the key is set.** A
  dedicated `market-prices-barchart` job (executor forces `source: 'barchart'`)
  runs the pull every **20 min, 08:00–17:59 UTC, Mon–Fri** (≈ Euronext Paris
  grain hours + the 10–15 min delay). Its schedule entry is added to
  `SCHEDULED_JOBS` **only when `BARCHART_API_KEY` is present** (a conditional
  spread in `schedules.ts`), so a key-less deployment runs no empty cron. Budget:
  one `getQuote` batches all symbols → ~150 requests/week — check against the
  Barchart plan before enabling. (A second `market-prices-pull` cron wasn't an
  option — `ScheduleDefinition.name` must be a unique `JobName`.) You can still
  trial ad-hoc with a manual `{ source: 'barchart' }` run.
- **Licence first.** Do not set `BARCHART_API_KEY` in prod until the delayed
  MATIF redistribution licence (Barchart sub-vendor fee + Euronext EMDA) is
  signed — the feed is for end-user display.
- **Barley + sunflower stay on the weekly EC feed** — no live source exists at
  any budget.
