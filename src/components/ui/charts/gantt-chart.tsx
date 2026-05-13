'use client';

/**
 * Roadmap-16 PR-11 — `<GanttChart>` primitive.
 *
 * R16 Gantt visualisation. Renders a vertical stack of rows, each
 * with a horizontal bar from `start` to `end`. Visual contract:
 *
 *   - Each bar paints via a horizontal `<ChartLinearGradient>` —
 *     the brighter start-stop on the left edge, deepening toward
 *     the end-stop on the right edge. Conveys time direction
 *     visually without needing a separate "earlier vs later"
 *     legend cue.
 *
 *   - Curved end-caps via SVG `rx={4}` on each `<rect>`. Same
 *     "polished, not stamped" treatment the donut got from
 *     visx's cornerRadius — Gantt bars look like jewellery
 *     rather than office-pack rectangles.
 *
 *   - Today line as a soft vertical wash (1 px stroke +
 *     `--bg-attention-emphasis` colour) crossing every row. The
 *     consumer can hide via `todayLine={false}` if the dataset
 *     doesn't anchor against today.
 *
 *   - Row labels on the left, rendered via `@visx/text` for
 *     consistent kerning + truncation.
 *
 *   - Dependency arrows (bezier curves) between rows when a
 *     `dependencies` field is present on a row. Each arrow runs
 *     from the END of the upstream bar to the START of the
 *     downstream bar via a soft curve.
 *
 * What's NOT in this PR:
 *
 *   - Hover beats (bar lift, dependency-chain highlight,
 *     tooltip). PR-12 wires those + closes R16 with the
 *     capstone bundle.
 */
import { useId } from 'react';
import { Group } from '@visx/group';
import { scaleBand, scaleUtc } from '@visx/scale';
import { Text } from '@visx/text';

import { ChartFrame } from './chart-frame';
import {
    ChartLinearGradient,
    chartGradientId,
    type ChartSeriesIndex,
} from './chart-gradient';
import type { ChartState } from './types';

/**
 * Bar corner radius (px). Same shape as the donut's
 * cornerRadius — polished, not stamped.
 */
const BAR_RADIUS = 4;

/**
 * Default per-row height (px). Tight enough to fit a meaningful
 * stack on a dashboard tile, generous enough that labels +
 * dependency arrows have breathing room.
 */
const ROW_HEIGHT = 28;

/**
 * Padding around the chart contents.
 */
const DEFAULT_PADDING = {
    top: 8,
    right: 16,
    bottom: 24,
    left: 120, // wider — accommodates the row labels on the left
};

export interface GanttRow {
    /** Stable key — used for React + dependency references. */
    key: string;
    /** Visible row label rendered in the left gutter. */
    label: string;
    /** Bar start (inclusive). */
    start: Date;
    /** Bar end (exclusive — bar spans `[start, end)`). */
    end: Date;
    /** R16 series index (1..6) for the bar's horizontal gradient. */
    seriesIndex: ChartSeriesIndex;
    /**
     * Optional list of upstream row keys this row depends on. Each
     * upstream → this dependency renders as a soft bezier arrow
     * from the end of the upstream bar to the start of this bar.
     */
    dependencies?: string[];
}

interface GanttChartProps {
    /** Discriminated data state wrapping the rows. */
    state: ChartState<GanttRow[]>;
    /**
     * Whether to render the today line. Defaults to true. Hide if
     * the data isn't anchored against the current calendar
     * (e.g. a Gantt of a long-completed past project).
     */
    todayLine?: boolean;
    /** Outer wrapper className. */
    className?: string;
    /** data-testid for the outer wrapper. */
    testId?: string;
    /** Optional aria-label override on the SVG. */
    ariaLabel?: string;
}

/**
 * Horizontal Gantt chart with gradient bars + dependency arrows.
 *
 * Consumer pattern:
 *
 *     const state = useAuditCyclesGantt();  // ChartState<GanttRow[]>
 *     return (
 *       <GanttChart
 *         state={state}
 *         testId="audit-cycles-gantt"
 *         ariaLabel="Audit cycles timeline"
 *       />
 *     );
 */
export function GanttChart({
    state,
    todayLine = true,
    className,
    testId,
    ariaLabel,
}: GanttChartProps) {
    return (
        <ChartFrame state={state} className={className} testId={testId}>
            {({ width, height, data }) => (
                <GanttChartInner
                    width={width}
                    height={height}
                    data={data}
                    todayLine={todayLine}
                    ariaLabel={ariaLabel}
                />
            )}
        </ChartFrame>
    );
}

interface GanttChartInnerProps {
    width: number;
    height: number;
    data: GanttRow[];
    todayLine: boolean;
    ariaLabel?: string;
}

function GanttChartInner({
    width,
    height,
    data,
    todayLine,
    ariaLabel,
}: GanttChartInnerProps) {
    const reactId = useId();
    const chartId = `gantt-${reactId.replace(/:/g, '')}`;

    if (data.length === 0) return null;

    const padding = DEFAULT_PADDING;
    const innerWidth = Math.max(0, width - padding.left - padding.right);
    const innerHeight = Math.max(0, height - padding.top - padding.bottom);

    // X-axis: time range covers the earliest start → latest end.
    const xMin = data.reduce(
        (acc, r) => (r.start < acc ? r.start : acc),
        data[0]!.start,
    );
    const xMax = data.reduce(
        (acc, r) => (r.end > acc ? r.end : acc),
        data[0]!.end,
    );
    const xScale = scaleUtc({
        domain: [xMin, xMax],
        range: [0, innerWidth],
    });

    // Y-axis: one band per row. scaleBand handles the row-height
    // computation + gives us padding between bars for free.
    const yScale = scaleBand({
        domain: data.map((r) => r.key),
        range: [0, Math.max(innerHeight, data.length * ROW_HEIGHT)],
        padding: 0.2,
    });

    // Unique series in the dataset → render one gradient def per
    // series (NOT one per row — adjacent rows sharing a series
    // would otherwise burn N defs).
    const seriesInUse = Array.from(new Set(data.map((r) => r.seriesIndex)));

    // For dependency arrows, build a lookup of key → bar geometry.
    const barGeometry = new Map(
        data.map((r) => {
            const x1 = xScale(r.start);
            const x2 = xScale(r.end);
            const y = (yScale(r.key) ?? 0) + yScale.bandwidth() / 2;
            return [r.key, { x1, x2, y }];
        }),
    );

    const todayX =
        todayLine && new Date() >= xMin && new Date() <= xMax
            ? xScale(new Date())
            : null;

    return (
        <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel ?? 'Gantt chart'}
        >
            <defs>
                {seriesInUse.map((series) => (
                    <ChartLinearGradient
                        key={series}
                        id={chartGradientId(chartId, series, 'linear')}
                        series={series}
                        direction="horizontal"
                    />
                ))}
            </defs>

            <Group left={padding.left} top={padding.top}>
                {/* Row separators — quiet horizontal hairlines so
                    the eye can scan across the time axis without
                    losing the row. */}
                {data.map((r) => {
                    const y = yScale(r.key) ?? 0;
                    return (
                        <line
                            key={`sep-${r.key}`}
                            x1={0}
                            x2={innerWidth}
                            y1={y + yScale.bandwidth() + yScale.step() * 0.1}
                            y2={y + yScale.bandwidth() + yScale.step() * 0.1}
                            stroke="var(--border-subtle)"
                            strokeWidth={1}
                            opacity={0.4}
                        />
                    );
                })}

                {/* Today line — soft vertical wash crossing every
                    row. Behind the bars so they layer cleanly. */}
                {todayX !== null && (
                    <line
                        x1={todayX}
                        x2={todayX}
                        y1={0}
                        y2={
                            Math.max(
                                innerHeight,
                                data.length * ROW_HEIGHT,
                            )
                        }
                        stroke="var(--bg-attention-emphasis)"
                        strokeWidth={1}
                        strokeDasharray="2 3"
                        opacity={0.5}
                    />
                )}

                {/* Bars. Each bar paints via the horizontal
                    series-gradient (lighter on the left, deeper
                    on the right — visual time-direction cue). */}
                {data.map((r) => {
                    const x1 = xScale(r.start);
                    const x2 = xScale(r.end);
                    const w = Math.max(0, x2 - x1);
                    const y = yScale(r.key) ?? 0;
                    const h = yScale.bandwidth();
                    const fill = `url(#${chartGradientId(chartId, r.seriesIndex, 'linear')})`;
                    return (
                        <rect
                            key={`bar-${r.key}`}
                            x={x1}
                            y={y}
                            width={w}
                            height={h}
                            rx={BAR_RADIUS}
                            ry={BAR_RADIUS}
                            fill={fill}
                        />
                    );
                })}

                {/* Dependency arrows — bezier curves from end of
                    upstream bar to start of downstream bar. The
                    curve avoids the orthogonal-90deg-arrow look
                    that reads as "engineering diagram" rather
                    than "lickable chart". */}
                {data.flatMap((r) =>
                    (r.dependencies ?? []).map((depKey) => {
                        const up = barGeometry.get(depKey);
                        const down = barGeometry.get(r.key);
                        if (!up || !down) return null;
                        // Control-point offsets give the curve a
                        // gentle S-shape between rows.
                        const dx = Math.max(20, (down.x1 - up.x2) / 2);
                        const path =
                            `M ${up.x2} ${up.y}` +
                            ` C ${up.x2 + dx} ${up.y},` +
                            ` ${down.x1 - dx} ${down.y},` +
                            ` ${down.x1} ${down.y}`;
                        return (
                            <path
                                key={`dep-${depKey}-${r.key}`}
                                d={path}
                                fill="none"
                                stroke="var(--content-muted)"
                                strokeWidth={1}
                                opacity={0.5}
                            />
                        );
                    }),
                )}

                {/* Row labels — left-gutter text. */}
                {data.map((r) => {
                    const y = (yScale(r.key) ?? 0) + yScale.bandwidth() / 2;
                    return (
                        <Text
                            key={`label-${r.key}`}
                            x={-12}
                            y={y}
                            textAnchor="end"
                            verticalAnchor="middle"
                            fontSize={11}
                            fontFamily="Inter, system-ui, sans-serif"
                            fill="var(--content-muted)"
                            width={padding.left - 24}
                        >
                            {r.label}
                        </Text>
                    );
                })}
            </Group>
        </svg>
    );
}
