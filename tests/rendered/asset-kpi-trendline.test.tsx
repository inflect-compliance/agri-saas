/**
 * Asset KPI trendlines (2026-06-06): the 4 asset KPI tiles gain an inline
 * sparkline (cumulative-by-createdAt). Covers the pure trend builder + the
 * KpiFilterCard sparkline wiring.
 */
import { render } from '@testing-library/react';
import * as React from 'react';
import type { TimeSeriesPoint } from '@/components/ui/charts';
import { buildCumulativeTrend } from '@/app/t/[tenantSlug]/(app)/assets/asset-kpi-trend';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';

const rows = [
    { createdAt: '2026-01-01T00:00:00Z', status: 'ACTIVE' },
    { createdAt: '2026-02-01T00:00:00Z', status: 'RETIRED' },
    { createdAt: '2026-03-01T00:00:00Z', status: 'ACTIVE' },
];

describe('buildCumulativeTrend', () => {
    it('returns [] when nothing matches', () => {
        expect(buildCumulativeTrend(rows, (r) => r.status === 'NOPE')).toEqual([]);
    });

    it('is cumulative + monotonic and ends at the total match count', () => {
        const series = buildCumulativeTrend(rows, () => true, 3);
        expect(series).toHaveLength(3);
        const values = series.map((p) => p.value);
        expect(values[values.length - 1]).toBe(3); // final = total
        // monotonic non-decreasing
        for (let i = 1; i < values.length; i++) {
            expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
        }
    });

    it('respects the predicate (only ACTIVE)', () => {
        const series = buildCumulativeTrend(rows, (r) => r.status === 'ACTIVE', 5);
        expect(series[series.length - 1].value).toBe(2);
    });

    it('a single matching date yields a flat 2-point line', () => {
        const series = buildCumulativeTrend([rows[0]], () => true);
        expect(series).toHaveLength(2);
        expect(series[0].value).toBe(1);
        expect(series[1].value).toBe(1);
    });
});

describe('KpiFilterCard sparkline', () => {
    const spark: TimeSeriesPoint[] = [
        { date: new Date('2026-01-01'), value: 1 },
        { date: new Date('2026-02-01'), value: 2 },
        { date: new Date('2026-03-01'), value: 3 },
    ];

    // MiniAreaChart's <ParentSize> renders its wrapper div (with the
    // passed className) but returns null inside at 0×0 (jsdom has no
    // layout), so we assert the wrapper, not the svg.
    // B2 (2026-06-07): the wrapper is to the RIGHT of the value (was
    // .mt-3.h-8.w-full stacked beneath it). B2-follow (#73, 2026-06-07):
    // it now spans the right HALF of the card (h-8 w-1/2), not a narrow chip.
    const sparkWrapper = (c: HTMLElement) =>
        c.querySelector('.h-8[class*="w-1/2"]');

    it('renders the sparkline wrapper when given ≥2 points', () => {
        const { container } = render(<KpiFilterCard label="Total assets" value={3} sparkline={spark} />);
        expect(sparkWrapper(container)).not.toBeNull();
    });

    it('lays the sparkline to the RIGHT of the value (B2 — flex row, not stacked below)', () => {
        const { container } = render(<KpiFilterCard label="Total assets" value={3} sparkline={spark} />);
        // value + sparkline share a horizontal flex row (items-end).
        expect(container.querySelector('.flex.items-end')).not.toBeNull();
        // the old below-the-value stacked wrapper is gone.
        expect(container.querySelector('.mt-3.h-8.w-full')).toBeNull();
    });

    it('renders no sparkline without data', () => {
        const { container } = render(<KpiFilterCard label="Total assets" value={3} />);
        expect(sparkWrapper(container)).toBeNull();
    });

    it('renders no sparkline with fewer than 2 points', () => {
        const { container } = render(
            <KpiFilterCard label="Total assets" value={1} sparkline={[{ date: new Date('2026-01-01'), value: 1 }]} />,
        );
        expect(sparkWrapper(container)).toBeNull();
    });
});
