"use client";

/**
 * `<RiskMatrix>` — config-driven matrix engine for Epic 44.3.
 *
 * Replaces the legacy `<RiskHeatmap>`'s hardcoded 5×5 layout with an
 * NxN renderer that reads dimensions, axis labels, severity bands,
 * and per-level vocabulary from `RiskMatrixConfigShape`. All cell
 * painting + tooltips delegate to `<RiskMatrixCell>`; the legend
 * delegates to `<RiskMatrixLegend>`. Both primitives ship from the
 * same Epic 44 contract so the engine stays presentational —
 * arrangement only, no per-band logic of its own.
 *
 * ## Default-parity guarantee
 *
 * When the engine is fed `DEFAULT_RISK_MATRIX_CONFIG`, the rendered
 * grid matches the legacy `<RiskHeatmap>` cell-for-cell:
 *
 *   - rows = likelihood, descending top-to-bottom (5 → 1)
 *   - cols = impact, ascending left-to-right (1 → 5)
 *   - row + column header columns at 24 px / 20 px reservations
 *   - "Likelihood" Y-axis title (vertical-LR rotated) on the left
 *   - "Impact" X-axis title under the grid
 *   - Low / Medium / High / Critical legend chips below
 *
 * The structural ratchet `tests/rendered/risk-matrix-default-parity.test.tsx`
 * locks this so a future "tidy-up" can't drift the visual.
 *
 * ## NxN
 *
 * `likelihoodLevels × impactLevels` drive the row + column counts.
 * Cell placement uses the SEMANTIC `(likelihood, impact)` pair from
 * the data, never the rendered (row, col) — `cellLookup.get(`${l}-${i}`)`
 * works identically whether the matrix is 5×5, 4×6, or 7×7.
 *
 * ## Axis swap
 *
 * `swapAxes={false}` (default): rows = likelihood (y), cols = impact (x).
 * `swapAxes={true}`: rows = impact (y), cols = likelihood (x).
 *
 * The data shape doesn't change — `(likelihood, impact)` stays
 * semantic — only the rendered axis assignment flips. Useful when
 * the operator wants probability on X vs Y depending on convention.
 *
 * ## Bubble overlay
 *
 * `mode='count'` (default): each cell shows the numeric count.
 * `mode='bubble'`: each cell shows up to `bubbleLimit` scenario
 * titles inline with a "+N more" overflow. Tooltip carries the
 * full list either way.
 */

import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import {
    RiskMatrixCell,
    type CellRisk,
} from '@/components/ui/RiskMatrixCell';
import { RiskMatrixLegend } from '@/components/ui/RiskMatrixLegend';
import type { RiskMatrixConfigShape } from '@/lib/risk-matrix/types';
import { Heading } from '@/components/ui/typography';

// ─── Public types ───────────────────────────────────────────────────

export interface RiskMatrixDataCell {
    /** 1-based likelihood (semantic axis). */
    likelihood: number;
    /** 1-based impact (semantic axis). */
    impact: number;
    /** Risk count at this (likelihood, impact). */
    count: number;
    /**
     * Optional per-risk metadata. Required for `mode='bubble'` to
     * render scenario chips; harmless to ship even in count mode.
     */
    risks?: ReadonlyArray<CellRisk>;
}

export interface RiskMatrixProps {
    /** Effective config for this tenant. */
    config: RiskMatrixConfigShape;
    /** Sparse list of cells with risks. Cells absent from the list render as empty (count=0). */
    cells: ReadonlyArray<RiskMatrixDataCell>;
    /** Render mode. Default: 'count'. */
    mode?: 'count' | 'bubble';
    /** Max risks per cell in bubble mode before "+N more". Default: 3. */
    bubbleLimit?: number;
    /**
     * When false (default), rows=likelihood / cols=impact. When true,
     * the axes flip: rows=impact / cols=likelihood. The DATA contract
     * is unchanged — only the rendered grid swaps axes.
     */
    swapAxes?: boolean;
    /** Show the built-in axis-swap toggle in the header. Default: true. */
    showSwapToggle?: boolean;
    /** Show the title + count chrome above the grid. Default: true. */
    showHeader?: boolean;
    /** Header title. Default: "Risk Matrix". */
    title?: string;
    /** Click handler — invoked with the underlying (semantic) cell. */
    onCellClick?: (cell: RiskMatrixDataCell) => void;
    /** Optional id of the currently-selected cell, in the form `${L}-${I}`. */
    selectedKey?: string | null;
    className?: string;
    id?: string;
    /** Test id forwarded to the outer card. */
    'data-testid'?: string;
}

// ─── Engine ─────────────────────────────────────────────────────────

export function RiskMatrix({
    config,
    cells,
    mode = 'count',
    bubbleLimit = 3,
    swapAxes: swapAxesProp,
    showSwapToggle = true,
    showHeader = true,
    title = 'Risk Matrix',
    onCellClick,
    selectedKey = null,
    className = '',
    id,
    'data-testid': dataTestId = 'risk-matrix',
}: RiskMatrixProps) {
    // The toggle is internal-state-by-default but accepts an external
    // override via `swapAxesProp` so a parent (e.g. a saved view) can
    // pin the value without us flickering on first render.
    const [internalSwap, setInternalSwap] = useState(false);
    const swapAxes = swapAxesProp ?? internalSwap;

    const lookup = useMemo(() => {
        const m = new Map<string, RiskMatrixDataCell>();
        for (const cell of cells) {
            m.set(`${cell.likelihood}-${cell.impact}`, cell);
        }
        return m;
    }, [cells]);

    const totalRisks = cells.reduce((s, c) => s + c.count, 0);

    // ── Rendered axes ───────────────────────────────────────────────
    //
    // In default orientation: rows = likelihood (top → bottom = max
    // → 1 — high likelihood at the top, the legacy heatmap shape),
    // cols = impact (left → right = 1 → max).
    //
    // Swapped: rows = impact (top → bottom = max → 1, "high impact
    // at the top" so visually-severe still reads up), cols =
    // likelihood (left → right = 1 → max).
    const yLevels = swapAxes ? config.impactLevels : config.likelihoodLevels;
    const xLevels = swapAxes ? config.likelihoodLevels : config.impactLevels;
    const yAxisLabel = swapAxes ? config.axisImpactLabel : config.axisLikelihoodLabel;
    const xAxisLabel = swapAxes ? config.axisLikelihoodLabel : config.axisImpactLabel;
    const yLabels = swapAxes
        ? config.levelLabels.impact
        : config.levelLabels.likelihood;
    const xLabels = swapAxes
        ? config.levelLabels.likelihood
        : config.levelLabels.impact;

    // Top → bottom: max → 1 (high severity / likelihood at the top,
    // matching the legacy heatmap's visual convention).
    const rows = useMemo(
        () => Array.from({ length: yLevels }, (_, i) => yLevels - i),
        [yLevels],
    );
    const cols = useMemo(
        () => Array.from({ length: xLevels }, (_, i) => i + 1),
        [xLevels],
    );

    // Resolve a SEMANTIC cell from a (rendered-row, rendered-col) pair.
    const cellAt = (yIdx: number, xIdx: number): RiskMatrixDataCell => {
        const likelihood = swapAxes ? xIdx : yIdx;
        const impact = swapAxes ? yIdx : xIdx;
        return (
            lookup.get(`${likelihood}-${impact}`) ?? {
                likelihood,
                impact,
                count: 0,
            }
        );
    };

    return (
        <div
            id={id}
            data-testid={dataTestId}
            data-swap-axes={swapAxes ? 'true' : 'false'}
            data-mode={mode}
            className={`glass-card p-6 ${className}`.trim()}
        >
            {showHeader && (
                <div className="mb-3 flex items-center justify-between">
                    <Heading level={3}>
                        {title}
                    </Heading>
                    <div className="flex items-center gap-3">
                        {showSwapToggle && swapAxesProp === undefined && (
                            <button
                                type="button"
                                onClick={() => setInternalSwap((p) => !p)}
                                className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 text-[10px] text-content-muted transition-colors hover:border-border-emphasis hover:text-content-emphasis"
                                aria-label="Swap matrix axes"
                                data-testid="risk-matrix-swap"
                            >
                                <ArrowLeftRight size={12} />
                                Swap axes
                            </button>
                        )}
                        <span className="text-xs text-content-subtle tabular-nums">
                            {totalRisks} {totalRisks === 1 ? 'risk' : 'risks'}
                        </span>
                    </div>
                </div>
            )}

            <div className="flex gap-2">
                {/* Y-axis title (vertical-LR rotation matches the legacy heatmap). */}
                <div className="-mr-1 flex flex-col items-center justify-center">
                    <span className="rotate-180 text-[10px] uppercase tracking-widest text-content-subtle [writing-mode:vertical-lr]">
                        {yAxisLabel}
                    </span>
                </div>

                <div className="flex-1">
                    {/* Grid — header column (24px) + N data columns;
                        data rows + footer row (20px). Each `[role=row]`
                        wrapper uses `display: contents` so the CSS Grid
                        layout still treats the row's children as direct
                        grid items, while ARIA gets the
                        `grid → row → {rowheader,gridcell,columnheader}`
                        hierarchy axe-AA's `aria-required-children`
                        rule expects. */}
                    <div
                        role="grid"
                        aria-label={`${yAxisLabel} by ${xAxisLabel} matrix`}
                        data-testid="risk-matrix-grid"
                        className="grid gap-[3px]"
                        style={{
                            gridTemplateColumns: `24px repeat(${xLevels}, 1fr)`,
                            gridTemplateRows: `repeat(${yLevels}, 1fr) 20px`,
                        }}
                    >
                        {rows.map((rowVal, yIdx) => (
                            <div
                                key={`row-${rowVal}`}
                                role="row"
                                style={{ display: 'contents' }}
                            >
                                {/* Row label (numeric). */}
                                <div
                                    role="rowheader"
                                    className="flex items-center justify-center text-[10px] tabular-nums text-content-subtle"
                                    title={
                                        yLabels[rowVal - 1] ?? String(rowVal)
                                    }
                                    data-testid={`risk-matrix-row-label-${rowVal}`}
                                >
                                    {rowVal}
                                </div>
                                {cols.map((colVal) => {
                                    // yIdx tells us which rendered row;
                                    // we resolve the semantic cell from
                                    // (rowVal, colVal) under the
                                    // current swap state.
                                    void yIdx; // silence unused; retained for clarity
                                    const cell = cellAt(rowVal, colVal);
                                    const cellKey = `${cell.likelihood}-${cell.impact}`;
                                    return (
                                        <RiskMatrixCell
                                            key={cellKey}
                                            likelihood={cell.likelihood}
                                            impact={cell.impact}
                                            count={cell.count}
                                            risks={cell.risks}
                                            mode={mode}
                                            bubbleLimit={bubbleLimit}
                                            config={config}
                                            selected={selectedKey === cellKey}
                                            onClick={
                                                onCellClick
                                                    ? () => onCellClick(cell)
                                                    : undefined
                                            }
                                        />
                                    );
                                })}
                            </div>
                        ))}

                        {/* X-axis numeric labels (footer row). */}
                        <div role="row" style={{ display: 'contents' }}>
                            <div /> {/* spacer for the row-label column */}
                            {cols.map((colVal) => (
                                <div
                                    key={`col-${colVal}`}
                                    role="columnheader"
                                    className="flex items-center justify-center text-[10px] tabular-nums text-content-subtle"
                                    title={xLabels[colVal - 1] ?? String(colVal)}
                                    data-testid={`risk-matrix-col-label-${colVal}`}
                                >
                                    {colVal}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-1 text-center">
                        <span className="text-[10px] uppercase tracking-widest text-content-subtle">
                            {xAxisLabel}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-3">
                <RiskMatrixLegend config={config} />
            </div>
        </div>
    );
}
