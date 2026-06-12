/**
 * RQ3-5 — `<AleHistogram>` (the third register view).
 *
 * Locks: decade bucketing (incl. empty between-buckets), band-stacked
 * segments in tenant colours, the per-risk appetite reference line
 * (and the domain stretch that keeps it on canvas), and the a11y
 * contract — generated aria summary + keyboard-focusable buckets.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';

jest.mock('@visx/responsive', () => ({
    ParentSize: ({ children }: { children: (s: { width: number }) => React.ReactNode }) =>
        children({ width: 600 }),
}));

import { AleHistogram, bucketByDecade, type AleHistogramDatum } from '@/components/ui/charts';

const d = (id: string, ale: number, bandName = 'High', bandColor = '#ef4444'): AleHistogramDatum => ({
    id,
    title: id,
    ale,
    bandName,
    bandColor,
});

const DATA = [
    d('a', 5_000, 'Low', '#22c55e'),
    d('b', 8_000, 'Low', '#22c55e'),
    d('c', 50_000, 'Medium', '#f59e0b'),
    d('d', 80_000, 'High', '#ef4444'),
    d('e', 5_000_000, 'Critical', '#7c2d12'),
];

describe('bucketByDecade (pure)', () => {
    it('buckets by decade and keeps empty between-buckets for honest gaps', () => {
        const buckets = bucketByDecade(DATA);
        // 10^3..10^6 inclusive = exps 3,4,5,6 (5M → exp 6).
        expect(buckets.map((b) => b.exp)).toEqual([3, 4, 5, 6]);
        expect(buckets[0].total).toBe(2); // 5K + 8K
        expect(buckets[1].total).toBe(2); // 50K + 80K
        expect(buckets[2].total).toBe(0); // empty gap stays visible
        expect(buckets[3].total).toBe(1);
    });

    it('stacks segments per band', () => {
        const buckets = bucketByDecade(DATA);
        expect(buckets[1].segments.map((s) => s.bandName).sort()).toEqual(['High', 'Medium']);
    });
});

describe('AleHistogram', () => {
    it('renders band-coloured stacked bars with focusable, labelled buckets', () => {
        render(<AleHistogram data={DATA} />);
        const bucket = screen.getByTestId('ale-histogram-bucket-4');
        expect(bucket).toHaveAttribute('tabindex', '0');
        expect(bucket.getAttribute('aria-label')).toMatch(/€10K–€100K: 2 risks/);
        const rects = bucket.querySelectorAll('rect');
        expect(rects).toHaveLength(2);
        const fills = [...rects].map((r) => r.getAttribute('fill')).sort();
        expect(fills).toEqual(['#ef4444', '#f59e0b']);
        // Empty buckets are skipped by the tab order.
        expect(screen.getByTestId('ale-histogram-bucket-5')).toHaveAttribute('tabindex', '-1');
    });

    it('carries a generated plain-language summary on the svg', () => {
        render(<AleHistogram data={DATA} />);
        const svg = screen.getByTestId('ale-histogram');
        expect(svg).toHaveAttribute('role', 'img');
        expect(svg.getAttribute('aria-label')).toMatch(/5 quantified risks/);
        expect(svg.getAttribute('aria-label')).toMatch(/tallest bucket/);
    });

    it('draws the appetite line and stretches the domain to keep it on canvas', () => {
        render(
            <AleHistogram
                data={DATA}
                referenceLine={{ value: 50_000_000, label: 'Per-risk appetite' }}
            />,
        );
        const ref = screen.getByTestId('ale-histogram-reference-line');
        expect(ref.querySelector('line')).toHaveAttribute('stroke-dasharray', '4 3');
        expect(ref.textContent).toContain('Per-risk appetite (€50.0M)');
        const x = parseFloat(ref.querySelector('line')!.getAttribute('x1')!);
        // Plot width = 600 − 36 − 24 = 540; the line must sit inside.
        expect(x).toBeGreaterThan(400);
        expect(x).toBeLessThanOrEqual(540);
    });

    it('renders nothing without quantified data (zero-cost default)', () => {
        render(<AleHistogram data={[]} />);
        expect(screen.queryByTestId('ale-histogram')).toBeNull();
    });
});
