/**
 * Epic 41 — dashboard widget rendering layer types.
 *
 * The renderer below is intentionally decoupled from the backend
 * `OrgDashboardWidgetType` enum. Backend rows store a (widgetType,
 * chartType, config) trio that's persisted-shape vocabulary; the
 * renderer takes a frontend `ChartType` that's visualization-shape
 * vocabulary. The mapping happens at the page / dispatcher layer
 * (later prompts) — this file is the rendering primitive's contract,
 * uncoupled from any single dashboard's wiring.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { MiniAreaChartVariant } from '@/components/ui/mini-area-chart';
import type { ProgressCircleVariant, ProgressCircleSize } from '@/components/ui/progress-circle';
import type { KpiFormat } from '@/components/ui/KpiCard';
import type { TrendPolarity } from '@/lib/kpi-trend';

/**
 * The set of visualization shapes the renderer understands. New
 * shapes are added by extending this union AND adding a switch arm
 * + tests; existing call sites are typesafe against the change.
 *
 *   - `kpi`        single number with label / sparkline / delta
 *   - `donut`      percent-share donut
 *   - `gauge`      single-percentage progress ring (real-estate)
 *   - `sparkline`  compact area chart, no axes / hover
 *   - `line`       time-series line (rendered as area-no-fill at
 *                  the platform layer; visx Areas without strong fill)
 *   - `area`       time-series filled area
 *   - `bar`        time-series bars
 */
export type ChartType =
    | 'kpi'
    | 'donut'
    | 'gauge'
    | 'sparkline'
    | 'line'
    | 'area'
    | 'bar';

/**
 * Render lifecycle envelope. Mirrors the chart-platform's
 * `chartReady / Loading / Empty / Error` state constructors so the
 * renderer can drop straight in alongside any existing platform
 * consumer.
 */
export type ChartRenderState = 'loading' | 'empty' | 'error' | 'ready';

// ─── Per-shape config ───────────────────────────────────────────────

export interface KpiConfig {
    label: string;
    value: number | null | undefined;
    format?: KpiFormat;
    /** Tailwind gradient classes for the headline value. */
    gradient?: string;
    icon?: LucideIcon;
    subtitle?: string;
    delta?: number | null;
    deltaLabel?: string;
    /**
     * Previous-period value for the auto-computed trend path. See
     * `KpiCard` and `computeKpiTrend` for the full contract.
     */
    previousValue?: number | null;
    /**
     * Polarity of the metric for good/bad colouring. See
     * `TrendPolarity` for the values + meaning.
     */
    trendPolarity?: TrendPolarity;
    /** Optional sparkline below the value. */
    sparkline?: ReadonlyArray<{ date: Date; value: number }>;
    sparklineVariant?: MiniAreaChartVariant;
}

/**
 * Optional target-line overlay on time-series charts. Renders a
 * dashed reference line at `value` on the y-axis with a label
 * anchored to the right edge of the plot.
 */
export interface ChartTargetConfig {
    value: number;
    label?: string;
    /**
     * Reserved for future use (label-colour polarity). The line
     * itself is always token-neutral so a busy chart stays readable.
     */
    polarity?: 'above-good' | 'below-good';
}

export interface DonutSegmentInput {
    label: string;
    value: number;
    color: string;
}

export interface DonutConfig {
    segments: ReadonlyArray<DonutSegmentInput>;
    centerLabel?: string;
    centerSub?: string;
    showLegend?: boolean;
    /** Diameter in px. Defaults to a chart-platform-aligned 160. */
    size?: number;
}

export interface GaugeConfig {
    /** Fractional progress in [0, 1]; clamped at the renderer. */
    progress: number;
    label?: ReactNode;
    variant?: ProgressCircleVariant;
    size?: ProgressCircleSize;
}

export interface SparklineConfig {
    points: ReadonlyArray<{ date: Date; value: number }>;
    variant?: MiniAreaChartVariant;
    ariaLabel?: string;
}

export interface TimeSeriesConfig {
    points: ReadonlyArray<{ date: Date; value: number }>;
    /** Stable id for the series; defaults to "series". */
    seriesId?: string;
    /** Token-backed colour class (e.g. `text-content-success`). */
    seriesColorClassName?: string;
    /** Series label rendered in the tooltip. */
    seriesLabel?: string;
    /** Custom empty-state node; falls through to the platform default. */
    emptyState?: ReactNode;
    /**
     * Optional dashed reference line at a specific y-value. Useful
     * for visualising SLAs / targets / thresholds against the
     * series. See `ChartTargetConfig` for shape.
     */
    target?: ChartTargetConfig;
}

// ─── Discriminated payload ──────────────────────────────────────────

interface BaseRenderProps {
    state?: ChartRenderState;
    /** When `state === 'error'`, an error message rendered inline. */
    error?: string;
    className?: string;
    /** Accessible label for the rendered visualization. */
    'aria-label'?: string;
}

interface KpiPayload extends BaseRenderProps {
    chartType: 'kpi';
    config: KpiConfig;
}

interface DonutPayload extends BaseRenderProps {
    chartType: 'donut';
    config: DonutConfig;
}

interface GaugePayload extends BaseRenderProps {
    chartType: 'gauge';
    config: GaugeConfig;
}

interface SparklinePayload extends BaseRenderProps {
    chartType: 'sparkline';
    config: SparklineConfig;
}

interface TimeSeriesPayload extends BaseRenderProps {
    chartType: 'line' | 'area' | 'bar';
    config: TimeSeriesConfig;
}

export type ChartRendererProps =
    | KpiPayload
    | DonutPayload
    | GaugePayload
    | SparklinePayload
    | TimeSeriesPayload;

/**
 * Type guard — narrows a `ChartType` to the time-series subset
 * (`line` / `area` / `bar`) for the renderer's switch arm. Lets the
 * dispatcher reuse one branch for all three.
 */
export function isTimeSeriesChartType(
    type: ChartType,
): type is 'line' | 'area' | 'bar' {
    return type === 'line' || type === 'area' || type === 'bar';
}
