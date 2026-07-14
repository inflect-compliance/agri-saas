/**
 * Unit test for the market-price trends read usecase.
 *
 * `getPriceTrends` reads the GLOBAL MarketPriceSeries/Point cache (no
 * tenantId) via the global prisma client and groups the result by
 * (source, region) so the chart can split lines by unit/currency. It is
 * Redis-cached per (commodity, range) for 6h. Both the prisma client and the
 * redis client are mocked here — no DB, no Redis.
 */

// jest.mock factories may reference vars prefixed with `mock` (hoisting rule).
const mockFindMany = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, swapped per case
let mockRedis: any = null;

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { marketPriceSeries: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));
jest.mock('@/lib/redis', () => ({ getRedis: () => mockRedis }));
jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { getPriceTrends } from '@/app-layer/usecases/trends';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(() => {
    mockFindMany.mockReset();
    mockRedis = null;
});

describe('getPriceTrends', () => {
    it('returns the empty-result shape when no series exist (Redis off)', async () => {
        mockFindMany.mockResolvedValue([]);
        const res = await getPriceTrends('wheat', '1y');
        expect(res).toEqual({ commodity: 'wheat', range: '1y', series: [] });
        expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it('groups series by (source, region) with per-series unit/currency + point shape', async () => {
        mockFindMany.mockResolvedValue([
            {
                source: 'ec-agrifood',
                region: 'BG',
                stage: 'Delivered to port',
                unit: 'EUR/t',
                currency: 'EUR',
                label: 'Common wheat',
                points: [
                    { date: d('2025-01-06'), price: 178, meta: null },
                    { date: d('2025-01-13'), price: 181.5, meta: null },
                ],
            },
            {
                source: 'listings',
                region: 'BG',
                stage: null,
                unit: 'BGN/t',
                currency: 'BGN',
                label: 'Own-listings median',
                // k-anon count travels in point meta.
                points: [{ date: d('2025-01-13'), price: 350, meta: { count: 4 } }],
            },
        ]);

        const res = await getPriceTrends('wheat', '3m');

        expect(res.commodity).toBe('wheat');
        expect(res.range).toBe('3m');
        expect(res.series).toHaveLength(2);

        const ec = res.series.find((s) => s.source === 'ec-agrifood')!;
        expect(ec).toMatchObject({ region: 'BG', unit: 'EUR/t', currency: 'EUR', label: 'Common wheat' });
        expect(ec.points).toEqual([
            { date: '2025-01-06', price: 178 },
            { date: '2025-01-13', price: 181.5 },
        ]);

        const listings = res.series.find((s) => s.source === 'listings')!;
        expect(listings).toMatchObject({ unit: 'BGN/t', currency: 'BGN' });
        // The listings point surfaces the distinct-tenant count from meta.
        expect(listings.points).toEqual([{ date: '2025-01-13', price: 350, count: 4 }]);
    });

    it('drops series that have zero points in the window', async () => {
        mockFindMany.mockResolvedValue([
            { source: 'alpha-vantage', region: 'GLOBAL', stage: null, unit: 'USD/t', currency: 'USD', label: 'x', points: [] },
        ]);
        const res = await getPriceTrends('maize', '1m');
        expect(res.series).toEqual([]);
    });

    it('serves a cache HIT without touching the DB', async () => {
        const cached = { commodity: 'barley', range: 'all', series: [{ source: 'ec-agrifood', region: 'BG', stage: null, unit: 'EUR/t', currency: 'EUR', label: null, points: [] }] };
        mockRedis = { get: jest.fn().mockResolvedValue(JSON.stringify(cached)), set: jest.fn() };

        const res = await getPriceTrends('barley', 'all');

        expect(res).toEqual(cached);
        expect(mockRedis.get).toHaveBeenCalledWith('trends:prices:v1:barley:all');
        expect(mockFindMany).not.toHaveBeenCalled();
        expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('on a cache MISS reads the DB and writes the cache with a 6h TTL', async () => {
        mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
        mockFindMany.mockResolvedValue([]);

        await getPriceTrends('sunflower', '1y');

        expect(mockFindMany).toHaveBeenCalledTimes(1);
        expect(mockRedis.set).toHaveBeenCalledTimes(1);
        const [key, , exFlag, ttl] = mockRedis.set.mock.calls[0];
        expect(key).toBe('trends:prices:v1:sunflower:1y');
        expect(exFlag).toBe('EX');
        expect(ttl).toBe(21600); // 6h
    });

    it('falls back to a live DB read when Redis.get throws', async () => {
        mockRedis = { get: jest.fn().mockRejectedValue(new Error('redis down')), set: jest.fn().mockResolvedValue('OK') };
        mockFindMany.mockResolvedValue([]);

        const res = await getPriceTrends('wheat', '1y');
        expect(res).toEqual({ commodity: 'wheat', range: '1y', series: [] });
        expect(mockFindMany).toHaveBeenCalledTimes(1);
    });
});
