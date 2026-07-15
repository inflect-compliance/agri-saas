/**
 * Pure helpers for the Trends Prices tab — grouping by unit, dense chart-data
 * assembly, and stat-tile derivations. No DOM / visx involved.
 */
import {
    groupSeriesByUnit,
    buildMergedData,
    seriesKey,
    sourceLabelKey,
    findEcSeries,
    findListingsSeries,
    findReferenceSeries,
    latestPoint,
    weekOverWeekDelta,
    isEmptyPayload,
    formatPrice,
    formatDelta,
    SOURCE_EC,
    SOURCE_AV,
    SOURCE_LISTINGS,
    type TrendSeries,
} from '@/components/trends/trends-helpers';

function ecSeries(region: string, points: Array<[string, number]>): TrendSeries {
    return {
        source: SOURCE_EC,
        region,
        stage: 'delivered',
        unit: 'EUR/t',
        currency: 'EUR',
        label: 'Wheat',
        points: points.map(([date, price]) => ({ date, price })),
    };
}

describe('trends-helpers', () => {
    describe('sourceLabelKey', () => {
        it('maps known sources to their i18n keys', () => {
            expect(sourceLabelKey(SOURCE_EC)).toBe('official');
            expect(sourceLabelKey(SOURCE_AV)).toBe('reference');
            expect(sourceLabelKey(SOURCE_LISTINGS)).toBe('listings');
            expect(sourceLabelKey('something-new')).toBe('other');
        });
    });

    describe('groupSeriesByUnit', () => {
        it('never puts different currency/unit series in one group', () => {
            const series: TrendSeries[] = [
                ecSeries('BG', [['2026-01-01', 200]]),
                ecSeries('RO', [['2026-01-01', 190]]),
                {
                    source: SOURCE_LISTINGS,
                    region: 'BG',
                    stage: null,
                    unit: 'BGN/t',
                    currency: 'BGN',
                    label: 'Own-listings median',
                    points: [{ date: '2026-01-01', price: 380, count: 7 }],
                },
                {
                    source: SOURCE_AV,
                    region: 'GLOBAL',
                    stage: null,
                    unit: 'USD/bu',
                    currency: 'USD',
                    label: 'Reference',
                    points: [{ date: '2026-01-01', price: 6.2 }],
                },
            ];
            const groups = groupSeriesByUnit(series);
            expect(groups).toHaveLength(3); // EUR/t (2 regions), BGN/t, USD/bu
            const eur = groups.find((g) => g.currency === 'EUR');
            expect(eur?.series).toHaveLength(2);
            for (const g of groups) {
                const units = new Set(g.series.map((s) => `${s.currency}|${s.unit}`));
                expect(units.size).toBe(1);
            }
        });

        it('drops series with no points', () => {
            const groups = groupSeriesByUnit([ecSeries('BG', [])]);
            expect(groups).toHaveLength(0);
        });
    });

    describe('buildMergedData', () => {
        it('produces dense rows — every series key present on every date', () => {
            const group = groupSeriesByUnit([
                ecSeries('BG', [
                    ['2026-01-01', 200],
                    ['2026-01-08', 210],
                ]),
                // RO misses the first week → must be back-filled, never 0.
                ecSeries('RO', [['2026-01-08', 195]]),
            ])[0];
            const rows = buildMergedData(group);
            expect(rows).toHaveLength(2);
            const bgKey = seriesKey({ source: SOURCE_EC, region: 'BG', stage: 'delivered' });
            const roKey = seriesKey({ source: SOURCE_EC, region: 'RO', stage: 'delivered' });
            // Back-fill: RO's first-known price (195) fills the earlier row.
            expect(rows[0].values[roKey]).toBe(195);
            expect(rows[0].values[bgKey]).toBe(200);
            expect(rows[1].values[roKey]).toBe(195);
            expect(rows[1].values[bgKey]).toBe(210);
        });

        it('forward-fills a mid-series gap instead of dipping to zero', () => {
            const group = groupSeriesByUnit([
                ecSeries('BG', [
                    ['2026-01-01', 200],
                    ['2026-01-15', 220],
                ]),
                ecSeries('RO', [
                    ['2026-01-01', 190],
                    ['2026-01-08', 195], // BG has no 01-08 point
                    ['2026-01-15', 205],
                ]),
            ])[0];
            const rows = buildMergedData(group);
            const bgKey = seriesKey({ source: SOURCE_EC, region: 'BG', stage: 'delivered' });
            const midRow = rows.find((r) => r.date.getTime() === Date.parse('2026-01-08T00:00:00Z'));
            expect(midRow?.values[bgKey]).toBe(200); // carried forward, not 0
        });
    });

    describe('stat-tile derivations', () => {
        const series: TrendSeries[] = [
            ecSeries('BG', [
                ['2026-01-01', 200],
                ['2026-01-10', 212],
            ]),
            {
                source: SOURCE_LISTINGS,
                region: 'BG',
                stage: null,
                unit: 'BGN/t',
                currency: 'BGN',
                label: 'Own-listings median',
                points: [{ date: '2026-01-10', price: 400, count: 9 }],
            },
        ];

        it('finds the BG official + listings series', () => {
            expect(findEcSeries(series, 'BG')?.region).toBe('BG');
            expect(findListingsSeries(series)?.source).toBe(SOURCE_LISTINGS);
            expect(findReferenceSeries(series)).toBeNull();
        });

        it('latestPoint returns the most recent point', () => {
            expect(latestPoint(series[0])?.price).toBe(212);
            expect(latestPoint(series[1])?.count).toBe(9);
        });

        it('weekOverWeekDelta compares against a point >=5 days back', () => {
            expect(weekOverWeekDelta(series[0])).toBe(12); // 212 - 200
        });

        it('weekOverWeekDelta is null with fewer than two points', () => {
            expect(weekOverWeekDelta(series[1])).toBeNull();
        });
    });

    describe('formatting + emptiness', () => {
        it('formatPrice trims integer vs decimal', () => {
            expect(formatPrice(200)).toBe('200');
            expect(formatPrice(212.5)).toBe('212.50');
        });

        it('formatDelta carries a sign', () => {
            expect(formatDelta(12)).toBe('+12.00');
            expect(formatDelta(-3.2)).toBe('−3.20');
        });

        it('isEmptyPayload is true only when no series has points', () => {
            expect(isEmptyPayload(undefined)).toBe(false);
            expect(
                isEmptyPayload({ commodity: 'wheat', range: '3m', series: [] }),
            ).toBe(true);
            expect(
                isEmptyPayload({
                    commodity: 'wheat',
                    range: '3m',
                    series: [ecSeries('BG', [])],
                }),
            ).toBe(true);
            expect(
                isEmptyPayload({
                    commodity: 'wheat',
                    range: '3m',
                    series: [ecSeries('BG', [['2026-01-01', 200]])],
                }),
            ).toBe(false);
        });
    });
});
