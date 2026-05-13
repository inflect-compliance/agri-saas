# Lickable Charts — R16 Decision Tree

Roadmap-16 (Lickable Charts) shipped 12 PRs across two phases:
**foundations** (tokens · gradients · frame · motion hooks) and
**chart primitives** (donut · line · radar · gantt) — each chart got
a visual rebuild PR plus a hover PR. This doc is the decision tree
for picking the right primitive and the right gradient layer.

## What's in `@/components/ui/charts`

After R16 the barrel exposes:

### Token + gradient primitives
- `<ChartLinearGradient>` — 2-stop linear gradient. Bars, area-under-line, gantt rows.
- `<ChartRadialGradient>` — radial gradient. Donut segments, radar polygon fill.
- `<ChartFlowGradient>` — 3-stop cyclic gradient + `gradientTransform`-animatable. Used by `useChartFlow` for hover gradient-pan.
- `chartGradientId(chartId, series, variant)` — canonical id helper.
- `type ChartSeriesIndex = 1 | 2 | 3 | 4 | 5 | 6` — palette is locked at 6.

### Frame + motion
- `<ChartFrame state={state}>` — responsive container + state-driven loading/empty/error/ready branches. Every R16 chart consumer mounts inside this.
- `useChartHoverPop({ hoveredKey })` — hover-pop transforms for donut segments / bars / line focus points / radar vertices.
- `useChartFlow({ active, distance, direction })` — animates `gradientTransform` translate on a `<ChartFlowGradient>` ref.

### Chart primitives
- `<DonutChart>` — proportional distribution (visx Pie + radial gradient + flow on hover). Existing in `@/components/ui/DonutChart`.
- `<LineChart>` — smooth single-series trend (curveCatmullRom + area-fade + crosshair on hover).
- `<RadarChart>` — multi-axis profile (polygon mesh + radial gradient + vertex pop on hover).
- `<GanttChart>` — horizontal timeline (gradient bars + bezier dependency arrows + chain highlight on hover).

## When to use which

```
                     ┌────────────────────────────────────────────┐
                     │              What are you visualising?     │
                     └────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼──────────────────────────────────┐
        │                                 │                                  │
        ▼                                 ▼                                  ▼
 Proportions of a            Trend over time                  Multi-dimensional
 single quantity              (single series)                  profile
        │                                 │                                  │
        ▼                                 ▼                                  ▼
   <DonutChart>                    <LineChart>                       <RadarChart>


                     ┌────────────────────────────────────────────┐
                     │      Schedule with dependencies?           │
                     └────────────────────────────────────────────┘
                                          │
                                          ▼
                                   <GanttChart>


                     ┌────────────────────────────────────────────┐
                     │      None of the above?                    │
                     └────────────────────────────────────────────┘
                                          │
                                          ▼
              fall back to existing chart-platform primitives
              (TimeSeriesChart, FunnelChart, Areas, Bars, ...)
```

## Picking a series index

`ChartSeriesIndex = 1..6`. The numeric index resolves to themed
hex stops at the token layer.

- **Series 1** — primary brand. The "headline" colour.
- **Series 2** — cyan METRO / navy PwC. The "cool" tone.
- **Series 3** — violet METRO / teal PwC. Secondary cool.
- **Series 4** — coral / rose. Warm-pink bridge.
- **Series 5** — emerald / forest. "Growth" / positive.
- **Series 6** — amber-warm. "Alert" / due-soon.

Adjacent series end/start stops are tuned for perceptually
neighbouring tones — adjacent shapes (stacked bars, donut
segments) blend visually at the boundary rather than jumping
between hues.

## The hover vocabulary (memorise this once, apply everywhere)

| Surface | Engage state | Tempo |
|---|---|---|
| Donut segment | translate 4 px radially outward + flow gradient pan | 200 ms ease-out |
| Bar / line focus | translate 2 px upward | 200 ms ease-out |
| Line focus point | scale 1.05× + tooltip + crosshair | 200 ms ease-out |
| Radar vertex | scale 1.05× + axis line brightens + label emphasis | 200 ms ease-out |
| Gantt bar | translateY -2 + dependency chain highlight | 200 ms ease-out |

Subtle by design. The user-confirmed "subtle" pop intensity
(R16-PR1) sits at small displacement values that read as "this
is the one you're pointing at" without making the chart feel
jumpy.

## When to NOT reach for R16

- **Static print views** — print stylesheets can render the
  chart-platform shape primitives directly without R16 motion.
- **Tiny KPI sparklines** — the existing `<MiniAreaChart>` (Epic 59)
  is built for compact cells and renders without a frame.
- **Pre-existing TimeSeriesChart consumers** — fine to leave as
  is. Migrate when re-touching the file for other reasons.

## Adding a 13th series

Don't. Six is locked at the token layer + `ChartSeriesIndex`
type union. Adding a 7th requires:
1. New tokens on both themes
2. `ChartSeriesIndex` widened in `chart-gradient.tsx`
3. Adjacent-tonal pairing re-validated (the 7th series'
   start-stop must sit in a perceptual neighbourhood of
   series 6's end-stop AND series 1's start-stop — closing
   the loop)
4. Ratchet at `tests/guards/r16-chart-tokens.test.ts` updated

It's not impossible — it's a conscious vocabulary change. Bring
the proposal explicitly.

## What R17 (if it ships) would cover

The deferred-until-R16-PR6-decision items (we picked "decide
later"). Once R16 lands, candidates for R17:

- Sankey rebuild on R16 primitives
- Heatmap polish (RiskHeatmap, CalendarHeatmap) — different
  visual idiom; needs its own colour-scale strategy
- Funnel polish
- Chart-pattern library (crosshatch for disabled, dots for
  projected, etc.) — for fills that need to convey state
  beyond hue
- Multi-axis stacked variants of the R16 chart primitives
- ChartTooltip primitive — currently each chart rolls its own
  hover affordance; a shared tooltip primitive could centralise
- GraphExplorer node refresh

## Quick API examples

### Donut
```tsx
const segments = [
  { label: 'Open', value: 10, seriesIndex: 6 },
  { label: 'Mitigating', value: 5, seriesIndex: 5 },
  { label: 'Closed', value: 3, seriesIndex: 3 },
];
<DonutChart segments={segments} centerLabel="18" centerSub="Risks" />
```

### Line
```tsx
const state = chartReady<TimeSeriesPoint[]>([
  { date: new Date('2026-04-01'), value: 70 },
  { date: new Date('2026-04-02'), value: 72 },
  // …
]);
<LineChart state={state} seriesIndex={1} ariaLabel="Readiness — last 30 days" />
```

### Radar
```tsx
const state = chartReady<RadarAxisDatum[]>([
  { key: 'access', label: 'Access control', value: 85 },
  { key: 'crypto', label: 'Cryptography', value: 92 },
  { key: 'incident', label: 'Incident response', value: 78 },
  // …
]);
<RadarChart state={state} seriesIndex={2} maxValue={100} />
```

### Gantt
```tsx
const state = chartReady<GanttRow[]>([
  {
    key: 'plan',
    label: 'Plan',
    start: new Date('2026-05-01'),
    end: new Date('2026-05-10'),
    seriesIndex: 1,
  },
  {
    key: 'execute',
    label: 'Execute',
    start: new Date('2026-05-10'),
    end: new Date('2026-05-25'),
    seriesIndex: 2,
    dependencies: ['plan'],
  },
  // …
]);
<GanttChart state={state} todayLine ariaLabel="Audit cycles timeline" />
```
