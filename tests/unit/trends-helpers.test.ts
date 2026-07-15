/**
 * Pure helpers for the Trends Prices tab — grouping by unit, dense chart-data
 * assembly, and stat-tile derivations. No DOM / visx involved.
 */
import {
    groupSeriesByRegionUnit,
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
    formatPriceWithCurrency,
    formatDelta,
    SOURCE_EC,
    SOURCE_AV,
    SOURCE_LISTINGS,
    type TrendSeries,
} from '@/components/trends/trends-helpers';

function ecSeries(
    region: string,
    points: Array<[string, number]>,
    stage: string | null = 'delivered',
): TrendSeries {
    return {
        source: SOURCE_EC,
        region,
        stage,
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

    describe('groupSeriesByRegionUnit', () => {
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
            const groups = groupSeriesByRegionUnit(series);
            for (const g of groups) {
                const units = new Set(g.series.map((s) => `${s.currency}|${s.unit}`));
                expect(units.size).toBe(1);
            }
        });

        it('splits same-currency regions into separate per-region charts', () => {
            // BG and EL are BOTH EUR/t now (Bulgaria's euro adoption), but must
            // still render as two charts, not one merged EUR/t chart.
            const groups = groupSeriesByRegionUnit([
                ecSeries('BG', [['2026-01-01', 512]]),
                ecSeries('EL', [['2026-01-01', 400]]),
            ]);
            expect(groups).toHaveLength(2);
            expect(groups.map((g) => g.region).sort()).toEqual(['BG', 'EL']);
            expect(groups.every((g) => g.series.length === 1)).toBe(true);
        });

        it('overlays a region’s own stages in one group', () => {
            // Same region + currency + unit, two stages → one chart, two lines.
            const groups = groupSeriesByRegionUnit([
                ecSeries('BG', [['2026-01-01', 512]], 'FGATE'),
                ecSeries('BG', [['2026-01-01', 505]], 'Not Defined'),
            ]);
            expect(groups).toHaveLength(1);
            expect(groups[0].series).toHaveLength(2);
        });

        it('drops series with no points', () => {
            const groups = groupSeriesByRegionUnit([ecSeries('BG', [])]);
            expect(groups).toHaveLength(0);
        });
    });

    describe('buildMergedData', () => {
        it('produces dense rows — every series key present on every date', () => {
            // Two stages of the same region (a real in-group overlay).
            const group = groupSeriesByRegionUnit([
                ecSeries(
                    'BG',
                    [
                        ['2026-01-01', 200],
                        ['2026-01-08', 210],
                    ],
                    'FGATE',
                ),
                // The second stage misses the first week → must be back-filled, never 0.
                ecSeries('BG', [['2026-01-08', 195]], 'DEPSILO'),
            ])[0];
            const rows = buildMergedData(group);
            expect(rows).toHaveLength(2);
            const aKey = seriesKey({ source: SOURCE_EC, region: 'BG', stage: 'FGATE' });
            const bKey = seriesKey({ source: SOURCE_EC, region: 'BG', stage: 'DEPSILO' });
            // Back-fill: the second stage's first-known price (195) fills the earlier row.
            expect(rows[0].values[bKey]).toBe(195);
            expect(rows[0].values[aKey]).toBe(200);
            expect(rows[1].values[bKey]).toBe(195);
            expect(rows[1].values[aKey]).toBe(210);
        });

        it('forward-fills a mid-series gap instead of dipping to zero', () => {
            const group = groupSeriesByRegionUnit([
                ecSeries(
                    'BG',
                    [
                        ['2026-01-01', 200],
                        ['2026-01-15', 220],
                    ],
                    'FGATE',
                ),
                ecSeries(
                    'BG',
                    [
                        ['2026-01-01', 190],
                        ['2026-01-08', 195], // the FGATE stage has no 01-08 point
                        ['2026-01-15', 205],
                    ],
                    'DEPSILO',
                ),
            ])[0];
            const rows = buildMergedData(group);
            const aKey = seriesKey({ source: SOURCE_EC, region: 'BG', stage: 'FGATE' });
            const midRow = rows.find((r) => r.date.getTime() === Date.parse('2026-01-08T00:00:00Z'));
            expect(midRow?.values[aKey]).toBe(200); // carried forward, not 0
        });
    });

    describe('formatPriceWithCurrency', () => {
        it('appends the ISO currency', () => {
            expect(formatPriceWithCurrency(512, 'EUR')).toBe('512 EUR');
            expect(formatPriceWithCurrency(512.5, 'EUR')).toBe('512.50 EUR');
        });
        it('omits the suffix when currency is empty', () => {
            expect(formatPriceWithCurrency(512, '')).toBe('512');
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
