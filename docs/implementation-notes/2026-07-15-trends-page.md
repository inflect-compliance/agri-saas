# 2026-07-15 — Trends page (prices charts) + market-trends dashboard widget

**Commit:** `<pending> feat(trends): Trends page — prices charts + market-trends widget`

## Design

User-facing UI on top of the market-price data backbone merged in #303
(`GET /api/t/[slug]/trends/prices?commodity=&range=` → series grouped by
`(source, region)`, each carrying its own `unit` + `currency`).

- **Route shell** — `src/app/t/[tenantSlug]/(app)/trends/page.tsx` is a thin
  server component that renders `<TrendsPageClient>`. The client tree lives
  under **`src/components/trends/`** (not the route folder) on purpose: the
  `single-tab-pattern` guard forbids `<TabSelect>` inside `src/app/**`, and
  both the page tabs and the range selector use `<TabSelect>`. All tab guards
  (`single-tab-pattern`, `no-inline-tab-strip`, `tab-count-discipline`,
  `epic60-ratchet`) scan `src/app` only, so housing the TabSelect consumers in
  `src/components` keeps CI green while honouring "use the shared tab
  primitive, never hand-roll a tab bar".
- **Two tabs** — `Prices` (built) and `News` (placeholder empty state, a real
  mount point the later News PR fills). `<TabSelect>` drives the tab bar.
- **Prices tab** — `<Combobox>` commodity picker (wheat/maize/barley/sunflower)
  + `<TabSelect>` range selector (1M/3M/1Y/All → `1m/3m/1y/all`). Data via
  `useTenantSWR(CACHE_KEYS.trends.prices(commodity, range))`. Stat tiles
  (latest BG official + WoW delta, listings index + sample count, reference
  latest) wrap on 390px. Charts use the Epic-59 `TimeSeriesChart` platform.
- **Widget** — `MarketTrendsWidget` (headline lead-commodity price +
  `MiniAreaChart` sparkline, whole-card `<Link>` to `/trends`) mounts in the
  tenant `DashboardClient.tsx`.

## The unit-axis decision (load-bearing)

The series carry **different units/currencies** — EC = EUR/t, own-listings =
BGN/t, Alpha Vantage = USD. `TimeSeriesChart` has a **single Y axis** (no
dual-axis capability), and mixing EUR + BGN on one axis is meaningless. So the
Prices tab **groups series by `${currency}|${unit}` and renders ONE chart per
unit-group**, stacked vertically, each declaring its unit in an axis caption.
Within a group, regions (BG/RO/EL/EU) are overlaid as distinct token-coloured
series; the legend tags each with its source
(`Official prices (EC)` / `Reference benchmark` / `Listings index`). Units are
never silently mixed. Grouping + dense chart-data assembly (forward/back-fill
so a one-week gap in one region never dips a line to zero) live in the pure,
unit-tested `trends-helpers.ts`.

## Unconfigured vs empty

The endpoint returns empty series both when EC/Alpha Vantage are **unconfigured**
and when the window is **genuinely empty** — the two are indistinguishable to
the client (no config flag on the payload). So the no-data panel carries BOTH:
an `EmptyState` titled "No data for this period" (bg: „Няма данни за периода")
plus an "For operators" explainer naming `EC_AGRIFOOD_BASE_URL` /
`ALPHA_VANTAGE_API_KEY`. Never a broken chart.

## Where the widget landed

The **tenant dashboard has no widget registry** (unlike the org dashboard's
Epic-41 configurable engine). It is a hand-composed static page
(`DashboardClient.tsx`). The widget is therefore mounted directly there,
alongside `<TasksTrendCard>` — the closest-matching existing pattern.

`BottomTabBar` is a fixed curated 5-surface list — left unchanged (no forced
6th tab). Trends is reachable from the sidebar/drawer nav.

## Files

| File | Role |
|---|---|
| `src/app/t/[tenantSlug]/(app)/trends/page.tsx` | Route server shell |
| `src/components/trends/TrendsPageClient.tsx` | Two-tab client shell (TabSelect) |
| `src/components/trends/PricesTab.tsx` | Commodity/range controls, stat tiles, per-unit charts, states |
| `src/components/trends/NewsTab.tsx` | Placeholder empty state |
| `src/components/trends/MarketTrendsWidget.tsx` | Dashboard widget (headline + sparkline + tap-through) |
| `src/components/trends/trends-helpers.ts` | Pure grouping / merge / stat helpers |
| `src/lib/swr-keys.ts` | `CACHE_KEYS.trends.prices(commodity, range)` |
| `src/components/layout/SidebarNav.tsx` | Trends nav item (Govern, `TrendingUp`) |
| `src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx` | Mounts the widget |
| `messages/{en,bg}.json` | `trends.*` + `sidebarNav.trends` |
| `tests/e2e/mobile/horizontal-drift.spec.ts` | `/trends` added to the drift ratchet |

## Decisions

- **Client tree in `src/components/trends/`, not the route folder** — to satisfy
  the `single-tab-pattern` guard (TabSelect banned in `src/app/**`) while still
  using the mandated shared tab primitive.
- **One chart per unit-group** — the platform has one Y axis; grouping is the
  only correct way to avoid mixing EUR/BGN/USD.
- **Default commodity `wheat`, default range `3m`** — wheat is Bulgaria's lead
  cereal and the widget's fixed commodity (no per-tenant "top commodity" signal
  exists yet); 3m is the most actionable recent window for a field trader.
- **Forward/back-fill in `buildMergedData`** — overlaid regional lines share a
  weekly cadence but a single missing point would otherwise spike a line to
  zero; fills keep lines continuous without distorting real movements.
- **No new backend** — the widget reuses `/trends/prices`; no `/dashboard/*`
  route was added.
