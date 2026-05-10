/**
 * RiskHeatmap — Likelihood × Impact matrix visualization.
 *
 * Renders a 5×5 grid where each cell shows the count of risks at
 * that (likelihood, impact) intersection. Color intensity encodes
 * the inherent risk level (likelihood × impact score).
 *
 * Color scheme:
 *   1-4:  green  (low)
 *   5-9:  amber  (medium)
 *   10-14: orange (high)
 *   15-25: red    (critical)
 *
 * @example
 * ```tsx
 * <RiskHeatmap
 *     cells={[
 *         { likelihood: 3, impact: 4, count: 2 },
 *         { likelihood: 5, impact: 5, count: 1 },
 *     ]}
 *     scale={5}
 * />
 * ```
 */
import { Fragment } from 'react';
import { cardVariants } from '@/components/ui/card-variants';
import { cn } from '@dub/utils';

import { ShimmerDots } from '@/components/ui/shimmer-dots';
import { Heading } from '@/components/ui/typography';

// ─── Props ──────────────────────────────────────────────────────────

export interface HeatmapCell {
    likelihood: number;
    impact: number;
    count: number;
}

export interface RiskHeatmapProps {
    /** Sparse cell data from backend */
    cells: HeatmapCell[];
    /** Maximum scale (default: 5) */
    scale?: number;
    /** Optional CSS class */
    className?: string;
    /** Optional test-id */
    id?: string;
    /**
     * Epic 64 — render `<ShimmerDots>` in place of the heatmap grid
     * (preserving the matrix footprint) while data is loading.
     * Distinct from `cells=[]` which renders the "no risks" state.
     */
    loading?: boolean;
}

// ─── Color Logic ────────────────────────────────────────────────────

function getCellColor(likelihood: number, impact: number, count: number): string {
    if (count === 0) return 'bg-bg-subtle';
    const score = likelihood * impact;
    if (score >= 15) return 'bg-red-500/80 text-white';
    if (score >= 10) return 'bg-orange-500/70 text-white';
    if (score >= 5)  return 'bg-amber-500/60 text-content-emphasis';
    return 'bg-emerald-500/50 text-content-emphasis';
}

function getScoreLabel(score: number): string {
    if (score >= 15) return 'Critical';
    if (score >= 10) return 'High';
    if (score >= 5)  return 'Medium';
    return 'Low';
}

// ─── Component ──────────────────────────────────────────────────────

export default function RiskHeatmap({
    cells,
    scale = 5,
    className = '',
    id,
    loading = false,
}: RiskHeatmapProps) {
    // Loading state — preserve matrix footprint with a same-size
    // shimmer grid so the dashboard doesn't reflow when data arrives.
    if (loading) {
        return (
            <div
                id={id}
                className={cn(cardVariants(), className)}
                data-heatmap-loading
            >
                <Heading level={3} className="mb-3">
                    Risk Heatmap
                </Heading>
                <ShimmerDots
                    rows={scale}
                    cols={scale}
                    dotSize="size-3"
                    className="aspect-square w-full"
                    aria-label="Heatmap loading"
                />
            </div>
        );
    }

    // Build lookup: `${likelihood}-${impact}` → count
    const lookup = new Map<string, number>();
    for (const cell of cells) {
        lookup.set(`${cell.likelihood}-${cell.impact}`, cell.count);
    }

    const totalRisks = cells.reduce((sum, c) => sum + c.count, 0);

    // Empty state
    if (totalRisks === 0) {
        return (
            <div id={id} className={cn(cardVariants(), className)}>
                <Heading level={3} className="mb-3">Risk Heatmap</Heading>
                <p className="text-xs text-content-subtle">No risks registered yet.</p>
            </div>
        );
    }

    // Axes: likelihood = rows (top=5), impact = columns (left=1)
    const rows = Array.from({ length: scale }, (_, i) => scale - i); // 5,4,3,2,1
    const cols = Array.from({ length: scale }, (_, i) => i + 1);     // 1,2,3,4,5

    return (
        <div id={id} className={cn(cardVariants(), className)}>
            <div className="flex items-center justify-between mb-3">
                <Heading level={3}>Risk Heatmap</Heading>
                <span className="text-xs text-content-subtle tabular-nums">{totalRisks} risks</span>
            </div>

            <div className="flex gap-tight">
                {/* Y-axis label */}
                <div className="flex flex-col items-center justify-center -mr-1">
                    <span className="text-[10px] text-content-subtle [writing-mode:vertical-lr] rotate-180 tracking-widest uppercase">
                        Likelihood
                    </span>
                </div>

                <div className="flex-1">
                    {/* Grid */}
                    <div
                        className="grid gap-[3px]"
                        style={{
                            gridTemplateColumns: `24px repeat(${scale}, 1fr)`,
                            gridTemplateRows: `repeat(${scale}, 1fr) 20px`,
                        }}
                    >
                        {rows.map((likelihood) => (
                            <Fragment key={`row-${likelihood}`}>
                                {/* Row label */}
                                <div
                                    className="flex items-center justify-center text-[10px] text-content-subtle tabular-nums"
                                >
                                    {likelihood}
                                </div>

                                {cols.map((impact) => {
                                    const count = lookup.get(`${likelihood}-${impact}`) ?? 0;
                                    const score = likelihood * impact;
                                    return (
                                        <div
                                            key={`${likelihood}-${impact}`}
                                            className={`
                                                flex items-center justify-center
                                                rounded-sm min-h-[28px]
                                                text-xs font-semibold tabular-nums
                                                transition-colors duration-150 ease-out
                                                ${getCellColor(likelihood, impact, count)}
                                                ${count > 0 ? 'cursor-default' : ''}
                                            `.trim()}
                                            title={`L${likelihood} × I${impact} = ${score} (${getScoreLabel(score)}) — ${count} risk${count !== 1 ? 's' : ''}`}
                                        >
                                            {count > 0 ? count : ''}
                                        </div>
                                    );
                                })}
                            </Fragment>
                        ))}

                        {/* X-axis labels */}
                        <div /> {/* spacer for row label column */}
                        {cols.map((impact) => (
                            <div
                                key={`col-${impact}`}
                                className="flex items-center justify-center text-[10px] text-content-subtle tabular-nums"
                            >
                                {impact}
                            </div>
                        ))}
                    </div>

                    {/* X-axis title */}
                    <div className="text-center mt-1">
                        <span className="text-[10px] text-content-subtle uppercase tracking-widest">
                            Impact
                        </span>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex justify-center gap-compact mt-3">
                {[
                    { label: 'Low', color: 'bg-emerald-500/50' },
                    { label: 'Medium', color: 'bg-amber-500/60' },
                    { label: 'High', color: 'bg-orange-500/70' },
                    { label: 'Critical', color: 'bg-red-500/80' },
                ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1 text-[10px] text-content-muted">
                        <span className={`w-2.5 h-2.5 rounded-sm ${item.color}`} />
                        <span>{item.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
