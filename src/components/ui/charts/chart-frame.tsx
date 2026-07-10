'use client';

/**
 * Roadmap-16 PR-3 — `<ChartFrame>` wrapper.
 *
 * Every R16 chart consumer (donut, line, radar, gantt) mounts
 * inside `<ChartFrame>`. The wrapper owns:
 *
 *   - Responsive sizing via `@visx/responsive`'s `ParentSize`.
 *   - Render-prop children: `(width, height) => svg-tree`.
 *   - State-driven branch rendering (`loading | empty | error |
 *     ready`) so consumers stop nesting ternaries.
 *   - Consistent outer chrome — token-backed bg, padding,
 *     rounded corners, optional min-height to prevent layout
 *     shift while data loads.
 *   - Skeleton fidelity: the loading branch matches the
 *     chart's eventual shape (donut → circle shimmer, line →
 *     wave shimmer, etc.) via a consumer-supplied
 *     `<SkeletonShape>`. The frame ships a sensible default.
 *   - Empty / error vocabularies that read the same across
 *     every chart in the product.
 *
 * Why a separate component:
 *
 *   - Today's chart consumers each hand-roll their loading
 *     skeleton + empty state + error state. Five different
 *     "still loading…" messages in the product. R16-PR3
 *     centralises this so the chart family feels coherent.
 *
 *   - `ParentSize` returns `{ width: 0, height: 0 }` during
 *     the first measurement pass. Every consumer has to guard
 *     against zero-size — `<ChartFrame>` does that for them.
 *
 *   - The state-discriminated branch logic stays in ONE place.
 *     Consumers thread `state` as a single prop instead of
 *     four (`loading`, `error`, `data`, `emptyMessage`).
 */
import { ReactElement, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ParentSize } from '@visx/responsive';

import { cn } from '@/lib/cn';
import { EmptyState } from '../empty-state';
import { ErrorState } from '../error-state';
import { Skeleton } from '../skeleton';

import type { ChartState } from './types';

/** Locked minimum chart height. Prevents layout shift while data loads. */
const DEFAULT_MIN_HEIGHT = 240;

interface ChartFrameProps<T> {
    /** Discriminated data state. R16 consumers thread the whole `ChartState`. */
    state: ChartState<T>;
    /**
     * Render-prop body — called only when `state.kind === 'ready'`.
     * Receives the measured `{ width, height }` from `<ParentSize>`.
     * The render-prop's return is the SVG tree.
     */
    children: (args: {
        width: number;
        height: number;
        data: T;
    }) => ReactNode;
    /** Extra classes on the outer wrapper. */
    className?: string;
    /** data-testid for the outer wrapper. */
    testId?: string;
    /** Override the default min-height (240 px). Pass `null` to disable. */
    minHeight?: number | null;
    /**
     * Optional override for the loading branch. Default: a
     * generic `<Skeleton>` block sized to fill the frame.
     */
    loadingFallback?: ReactNode;
    /**
     * Optional override for the empty branch. Default:
     * `<EmptyState size="sm" title="No data yet" description="..."/>`.
     */
    emptyFallback?: ReactNode;
    /**
     * Optional override for the error branch. Default:
     * `<ErrorState title="Couldn’t load chart" message={state.message}/>`.
     */
    errorFallback?: ReactNode;
}

/**
 * Responsive chart container with state-driven branch rendering.
 *
 * Typical consumer shape:
 *
 *     const state = useReadinessTrend();
 *     return (
 *       <ChartFrame state={state} testId="readiness-trend">
 *         {({ width, height, data }) => (
 *           <svg width={width} height={height}>
 *             <defs><ChartLinearGradient id="…" series={1} /></defs>
 *             ...
 *           </svg>
 *         )}
 *       </ChartFrame>
 *     );
 */
export function ChartFrame<T>({
    state,
    children,
    className,
    testId,
    minHeight = DEFAULT_MIN_HEIGHT,
    loadingFallback,
    emptyFallback,
    errorFallback,
}: ChartFrameProps<T>): ReactElement {
    const t = useTranslations('chartFrame');
    // Loading / empty / error short-circuit the responsive
    // measurement — no point laying out a `ParentSize` for a
    // skeleton. The outer min-height keeps the layout stable
    // across state changes.
    if (state.kind === 'loading') {
        return (
            <ChartFrameOuter
                className={className}
                testId={testId}
                minHeight={minHeight}
                stateKind="loading"
            >
                {loadingFallback ?? (
                    <Skeleton className="size-full rounded-lg" />
                )}
            </ChartFrameOuter>
        );
    }

    if (state.kind === 'error') {
        return (
            <ChartFrameOuter
                className={className}
                testId={testId}
                minHeight={minHeight}
                stateKind="error"
            >
                {errorFallback ?? (
                    <ErrorState
                        title={t('errorTitle')}
                        description={state.message}
                    />
                )}
            </ChartFrameOuter>
        );
    }

    if (state.kind === 'empty') {
        return (
            <ChartFrameOuter
                className={className}
                testId={testId}
                minHeight={minHeight}
                stateKind="empty"
            >
                {emptyFallback ?? (
                    <EmptyState
                        size="sm"
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                    />
                )}
            </ChartFrameOuter>
        );
    }

    // state.kind === 'ready' — measure and render.
    return (
        <ChartFrameOuter
            className={className}
            testId={testId}
            minHeight={minHeight}
            stateKind="ready"
        >
            <ParentSize className="relative size-full">
                {({ width, height }) => {
                    // ParentSize returns 0×0 during the first
                    // measurement pass. Guard so consumers don't
                    // have to.
                    if (width === 0 || height === 0) return null;
                    return children({ width, height, data: state.data });
                }}
            </ParentSize>
        </ChartFrameOuter>
    );
}

interface ChartFrameOuterProps {
    children: ReactNode;
    className?: string;
    testId?: string;
    minHeight: number | null;
    stateKind: ChartState<unknown>['kind'];
}

/**
 * The chrome around the inner branch. Same shape on every
 * branch — only `data-chart-state` differs so consumers can
 * style per-state if needed (e.g. a quieter bg for the empty
 * branch). Locked here so chart-frame visual contract stays
 * uniform.
 */
function ChartFrameOuter({
    children,
    className,
    testId,
    minHeight,
    stateKind,
}: ChartFrameOuterProps): ReactElement {
    return (
        <div
            data-chart-frame="true"
            data-chart-state={stateKind}
            data-testid={testId}
            className={cn(
                // Outer chrome — bg + rounded corner + relative
                // anchor for any future overlay (tooltips, etc.).
                'relative rounded-lg bg-bg-elevated/40',
                // Centre the loading / empty / error fallbacks
                // inside the frame. The ready branch's ParentSize
                // is already `size-full`, so this `flex` doesn't
                // affect it.
                'flex items-center justify-center',
                // Default padding. Consumers can override via
                // className with `p-0` for edge-to-edge charts.
                'p-4',
                className,
            )}
            style={
                minHeight !== null ? { minHeight: `${minHeight}px` } : undefined
            }
        >
            {children}
        </div>
    );
}
