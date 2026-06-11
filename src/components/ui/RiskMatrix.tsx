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
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

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
    /**
     * RQ2-5 — summed resolved ALE of this cell's risks. Enables the
     * ALE heat overlay toggle; omit (or 0) everywhere and the matrix
     * behaves exactly as before — the toggle never renders.
     */
    totalAle?: number;
}

/**
 * RQ2-9 — one inherent → residual movement. Only risks with a
 * DECOMPOSED residual (RQ2-1 dims) can draw an arrow; legacy
 * undecomposed rows have no destination cell and are excluded by
 * the caller.
 */
export interface RiskMovement {
    riskId: string;
    title: string;
    from: { likelihood: number; impact: number };
    to: { likelihood: number; impact: number };
}

export interface RiskMatrixProps {
    /** Effective config for this tenant. */
    config: RiskMatrixConfigShape;
    /** Sparse list of cells with risks. Cells absent from the list render as empty (count=0). */
    cells: ReadonlyArray<RiskMatrixDataCell>;
    /**
     * RQ2-9 — inherent → residual movements. Enables the movement
     * toggle; omit (or empty) and the matrix behaves exactly as
     * before — the toggle never renders.
     */
    movements?: ReadonlyArray<RiskMovement>;
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
    movements,
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

    // RQ2-5 — ALE heat overlay. The toggle only exists when at least
    // one cell carries monetary data: an unquantified portfolio pays
    // zero cost and sees zero new chrome.
    const [aleOverlay, setAleOverlay] = useState(false);
    const maxCellAle = useMemo(
        () => cells.reduce((m, c) => Math.max(m, c.totalAle ?? 0), 0),
        [cells],
    );
    const hasAleData = maxCellAle > 0;
    const aleOverlayActive = aleOverlay && hasAleData;

    // RQ2-9 — movement overlay. Zero-cost without movement data.
    const [showMovement, setShowMovement] = useState(false);
    const hasMovements = (movements?.length ?? 0) > 0;
    const movementActive = showMovement && hasMovements;
    // Deduplicate identical (from → to) pairs into one arrow with a
    // count — ten risks taking the same path is one fat arrow, not
    // ten overdrawn ones. Same-cell pairs (no movement) are skipped.
    const movementArrows = useMemo(() => {
        if (!movements) return [];
        const byPath = new Map<string, { from: { likelihood: number; impact: number }; to: { likelihood: number; impact: number }; count: number }>();
        for (const m of movements) {
            if (m.from.likelihood === m.to.likelihood && m.from.impact === m.to.impact) continue;
            const key = `${m.from.likelihood}-${m.from.impact}>${m.to.likelihood}-${m.to.impact}`;
            const cur = byPath.get(key);
            if (cur) cur.count += 1;
            else byPath.set(key, { from: m.from, to: m.to, count: 1 });
        }
        return Array.from(byPath.values());
    }, [movements]);

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
            data-ale-overlay={aleOverlayActive ? 'true' : 'false'}
            data-movement={movementActive ? 'true' : 'false'}
            className={cn(cardVariants(), className)}
        >
            {showHeader && (
                <div className="mb-3 flex items-center justify-between">
                    <Heading level={3}>
                        {title}
                    </Heading>
                    <div className="flex items-center gap-compact">
                        {hasMovements && (
                            <button
                                type="button"
                                onClick={() => setShowMovement((p) => !p)}
                                aria-pressed={showMovement}
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                                    showMovement
                                        ? 'border-border-emphasis text-content-emphasis'
                                        : 'border-border-subtle text-content-muted hover:border-border-emphasis hover:text-content-emphasis',
                                )}
                                aria-label="Toggle inherent to residual movement overlay"
                                data-testid="risk-matrix-movement-toggle"
                            >
                                → Movement
                            </button>
                        )}
                        {hasAleData && (
                            <button
                                type="button"
                                onClick={() => setAleOverlay((p) => !p)}
                                aria-pressed={aleOverlay}
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                                    aleOverlay
                                        ? 'border-border-emphasis text-content-emphasis'
                                        : 'border-border-subtle text-content-muted hover:border-border-emphasis hover:text-content-emphasis',
                                )}
                                aria-label="Toggle ALE heat overlay"
                                data-testid="risk-matrix-ale-toggle"
                            >
                                € ALE heat
                            </button>
                        )}
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

            <div className="flex gap-tight">
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
                        className="relative grid gap-[3px]"
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
                                            aleOverlay={aleOverlayActive}
                                            totalAle={cell.totalAle}
                                            aleShare={
                                                aleOverlayActive && maxCellAle > 0
                                                    ? (cell.totalAle ?? 0) / maxCellAle
                                                    : undefined
                                            }
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

                        {/* RQ2-9 — movement overlay. Absolutely
                            positioned over the data-cell area only
                            (header column + footer row excluded), so
                            percentage coordinates in the NxN space
                            map 1:1 onto cell centres. Decorative —
                            the per-risk story lives in the
                            assessment tab; aria summarises. */}
                        {movementActive && (
                            <svg
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                                role="img"
                                aria-label={`${movementArrows.reduce((sum, a) => sum + a.count, 0)} risks moved from inherent to residual position`}
                                data-testid="risk-matrix-movement-overlay"
                                className="pointer-events-none"
                                style={{
                                    position: 'absolute',
                                    left: 27,
                                    top: 0,
                                    right: 0,
                                    bottom: 23,
                                    width: 'calc(100% - 27px)',
                                    height: 'calc(100% - 23px)',
                                }}
                            >
                                {movementArrows.map((a) => {
                                    const px = (p: { likelihood: number; impact: number }) => {
                                        const xVal = swapAxes ? p.likelihood : p.impact;
                                        const yVal = swapAxes ? p.impact : p.likelihood;
                                        return {
                                            x: ((xVal - 0.5) / xLevels) * 100,
                                            y: ((yLevels - yVal + 0.5) / yLevels) * 100,
                                        };
                                    };
                                    const from = px(a.from);
                                    const to = px(a.to);
                                    const key = `${a.from.likelihood}-${a.from.impact}>${a.to.likelihood}-${a.to.impact}`;
                                    return (
                                        <g key={key} data-testid="risk-matrix-movement-arrow" data-count={a.count}>
                                            <line
                                                x1={from.x}
                                                y1={from.y}
                                                x2={to.x}
                                                y2={to.y}
                                                stroke="var(--content-emphasis, #0f172a)"
                                                strokeWidth={a.count > 1 ? 1.2 : 0.7}
                                                strokeOpacity={0.75}
                                            />
                                            {/* origin ring + destination dot — the
                                                pair reads direction without an
                                                aspect-distorted arrowhead. */}
                                            <circle cx={from.x} cy={from.y} r={1.6} fill="none" stroke="var(--content-emphasis, #0f172a)" strokeWidth={0.5} strokeOpacity={0.75} />
                                            <circle cx={to.x} cy={to.y} r={1.6} fill="var(--content-emphasis, #0f172a)" fillOpacity={0.9} />
                                            {a.count > 1 && (
                                                <text
                                                    x={(from.x + to.x) / 2}
                                                    y={(from.y + to.y) / 2 - 1.5}
                                                    fontSize={4}
                                                    textAnchor="middle"
                                                    fill="var(--content-emphasis, #0f172a)"
                                                >
                                                    ×{a.count}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>
                        )}

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

            {/* polish #2 — movement legend. Only renders alongside
                the overlay so an off-toggle matrix stays uncluttered. */}
            {movementActive && (
                <div
                    className="mt-3 flex flex-wrap items-center gap-default text-[10px] text-content-muted"
                    data-testid="risk-matrix-movement-legend"
                >
                    <span className="inline-flex items-center gap-1">
                        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-content-emphasis bg-transparent" />
                        inherent (origin)
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-content-emphasis" />
                        residual (destination)
                    </span>
                    <span>·</span>
                    <span>thicker line + ×N where multiple risks share the path</span>
                </div>
            )}

            <div className="mt-3">
                <RiskMatrixLegend config={config} />
            </div>
        </div>
    );
}
