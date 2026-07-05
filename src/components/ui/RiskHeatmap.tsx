'use client';

/**
 * Roadmap-21 PR-C — RiskHeatmap rebuild on R21-PR-A's useHeatScale +
 * ChartLegend foundation.
 *
 * The original 5×5 likelihood × impact matrix used a bespoke
 * four-bucket palette (emerald → amber → orange → red) keyed off
 * a discrete `getCellColor()` lookup. Worked, but spoke a different
 * colour vocabulary from every other chart on the dashboard and
 * couldn't be themed through tokens.
 *
 * PR-C rewires the cell colouring through `useHeatScale` (R21-PR-A)
 * mapped to chart-series 4 (pink → magenta — the closest available
 * "severity" ramp in the R16 palette). The interpolation is
 * continuous in OKLAB so the gradation reads cleanly even at the
 * boundary between adjacent severity scores. The bottom-strip
 * 4-swatch legend is replaced by `<ChartLegend variant="gradient">`
 * — the legend gradient paints from the SAME tokens the cells
 * consume, so legend ↔ cells are visually continuous.
 *
 * Three interaction refinements on top:
 *
 *   1. Hover crosshair — hovering a cell highlights the WHOLE row
 *      AND column the cell belongs to (the canonical "what cell
 *      am I looking at?" affordance for matrix heatmaps).
 *
 *   2. Click-to-drill — `onSelectCell` callback fires the
 *      (likelihood, impact, count) triple so the consumer can
 *      open a drill-down sheet. Cells with count=0 are not
 *      clickable.
 *
 *   3. Empty-cell muted affordance — count=0 cells paint at the
 *      heat-scale's floor opacity (15%) rather than `bg-bg-subtle`
 *      so the empty cells STILL participate in the gradient
 *      vocabulary, just at the bottom of the ramp.
 *
 * @example
 * ```tsx
 * <RiskHeatmap
 *     cells={[
 *         { likelihood: 3, impact: 4, count: 2 },
 *         { likelihood: 5, impact: 5, count: 1 },
 *     ]}
 *     scale={5}
 *     onSelectCell={(cell) => router.push(`/risks?L=${cell.likelihood}&I=${cell.impact}`)}
 * />
 * ```
 */
import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cardVariants } from '@/components/ui/card-variants';
import { cn } from '@/lib/cn';

import { ChartLegend, useHeatScale } from '@/components/ui/charts';
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
    /**
     * R21-PR-C — click-to-drill. Fires the cell triple
     * (likelihood, impact, count) when a populated cell is clicked.
     * Cells with count=0 are not clickable.
     */
    onSelectCell?: (cell: HeatmapCell) => void;
}

// ─── Component ──────────────────────────────────────────────────────

export default function RiskHeatmap({
    cells,
    scale = 5,
    className = '',
    id,
    loading = false,
    onSelectCell,
}: RiskHeatmapProps) {
    const t = useTranslations('ui');
    // R21-PR-C — continuous OKLAB heat scale over the
    // likelihood×impact SCORE domain (1..scale²). Series 4 (pink)
    // is the closest available "severity" ramp in the R16 palette.
    const scoreMax = scale * scale;
    const heat = useHeatScale({
        domain: [1, scoreMax],
        series: 4,
        idPrefix: id ? `${id}-risk` : 'risk-heat',
    });

    // Hover crosshair state. Track row + column independently so a
    // future PR can support keyboard navigation (arrow keys updating
    // crosshair without mouse) without restructuring.
    const [hovered, setHovered] = useState<{
        likelihood: number;
        impact: number;
    } | null>(null);

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
                    {t('riskHeatmap.title')}
                </Heading>
                <ShimmerDots
                    rows={scale}
                    cols={scale}
                    dotSize="size-3"
                    className="aspect-square w-full"
                    aria-label={t('riskHeatmap.loading')}
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
                <Heading level={3} className="mb-3">{t('riskHeatmap.title')}</Heading>
                <p className="text-xs text-content-subtle">{t('riskHeatmap.emptyState')}</p>
            </div>
        );
    }

    // Axes: likelihood = rows (top=5), impact = columns (left=1)
    const rows = Array.from({ length: scale }, (_, i) => scale - i); // 5,4,3,2,1
    const cols = Array.from({ length: scale }, (_, i) => i + 1);     // 1,2,3,4,5

    return (
        <div id={id} className={cn(cardVariants(), className)}>
            <div className="flex items-center justify-between mb-3">
                <Heading level={3}>{t('riskHeatmap.title')}</Heading>
                <span className="text-xs text-content-subtle tabular-nums">{t('riskHeatmap.riskCount', { count: totalRisks })}</span>
            </div>

            <div className="flex gap-tight">
                {/* Y-axis label */}
                <div className="flex flex-col items-center justify-center -mr-1">
                    <span className="text-[10px] text-content-subtle [writing-mode:vertical-lr] rotate-180 tracking-widest uppercase">
                        {t('riskHeatmap.likelihood')}
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
                                    className={cn(
                                        'flex items-center justify-center text-[10px] tabular-nums transition-colors duration-150',
                                        hovered?.likelihood === likelihood
                                            ? 'text-content-emphasis font-semibold'
                                            : 'text-content-subtle',
                                    )}
                                >
                                    {likelihood}
                                </div>

                                {cols.map((impact) => {
                                    const count = lookup.get(`${likelihood}-${impact}`) ?? 0;
                                    const score = likelihood * impact;
                                    const isCrosshair =
                                        hovered !== null &&
                                        (hovered.likelihood === likelihood ||
                                            hovered.impact === impact);
                                    const isHovered =
                                        hovered?.likelihood === likelihood &&
                                        hovered?.impact === impact;
                                    const clickable = count > 0 && Boolean(onSelectCell);
                                    return (
                                        <button
                                            type="button"
                                            key={`${likelihood}-${impact}`}
                                            data-likelihood={likelihood}
                                            data-impact={impact}
                                            data-count={count}
                                            data-score={score}
                                            data-cell-crosshair={isCrosshair ? 'true' : undefined}
                                            data-cell-hover={isHovered ? 'true' : undefined}
                                            disabled={!clickable}
                                            onMouseEnter={() =>
                                                setHovered({ likelihood, impact })
                                            }
                                            onMouseLeave={() => setHovered(null)}
                                            onFocus={() =>
                                                setHovered({ likelihood, impact })
                                            }
                                            onBlur={() => setHovered(null)}
                                            onClick={() => {
                                                if (clickable)
                                                    onSelectCell?.({
                                                        likelihood,
                                                        impact,
                                                        count,
                                                    });
                                            }}
                                            className={cn(
                                                'flex items-center justify-center rounded-sm min-h-[28px]',
                                                'text-xs font-semibold tabular-nums text-white',
                                                'transition-[background-color,outline-color,opacity] duration-150 ease-out',
                                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                                                clickable && 'cursor-pointer',
                                                !clickable && 'cursor-default',
                                                isCrosshair && !isHovered && 'ring-1 ring-content-emphasis/30',
                                                isHovered && 'ring-2 ring-content-emphasis/60',
                                            )}
                                            style={{
                                                background: heat.colorFor(score),
                                                // Empty cells paint at the
                                                // heat-scale's floor — they
                                                // stay PART of the gradient
                                                // vocabulary, just at the
                                                // bottom of the ramp.
                                                opacity: count === 0 ? 0.4 : 1,
                                            }}
                                            title={t('riskHeatmap.cellTitle', {
                                                likelihood,
                                                impact,
                                                score,
                                                count,
                                            })}
                                        >
                                            {count > 0 ? count : ''}
                                        </button>
                                    );
                                })}
                            </Fragment>
                        ))}

                        {/* X-axis labels */}
                        <div /> {/* spacer for row label column */}
                        {cols.map((impact) => (
                            <div
                                key={`col-${impact}`}
                                className={cn(
                                    'flex items-center justify-center text-[10px] tabular-nums transition-colors duration-150',
                                    hovered?.impact === impact
                                        ? 'text-content-emphasis font-semibold'
                                        : 'text-content-subtle',
                                )}
                            >
                                {impact}
                            </div>
                        ))}
                    </div>

                    {/* X-axis title */}
                    <div className="text-center mt-1">
                        <span className="text-[10px] text-content-subtle uppercase tracking-widest">
                            {t('riskHeatmap.impact')}
                        </span>
                    </div>
                </div>
            </div>

            {/* R21-PR-C: shared gradient legend, painted from the same
                tokens the cells consume — visually continuous. */}
            <div className="flex justify-center mt-3">
                <ChartLegend
                    variant="gradient"
                    heatScale={heat}
                    label={t('riskHeatmap.legendLabel')}
                />
            </div>
        </div>
    );
}
