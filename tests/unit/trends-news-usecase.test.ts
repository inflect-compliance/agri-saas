/**
 * Unit test for the market-news read usecase.
 *
 * `getMarketNews` reads the GLOBAL MarketNewsItem cache (no tenantId) via the
 * global prisma client, newest-first, optionally filtered by category, and is
 * Redis-cached per (category, limit) for 1h. Both prisma + redis are mocked —
 * no DB, no Redis.
 */
const mockFindMany = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, swapped per case
let mockRedis: any = null;

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { marketNewsItem: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));
jest.mock('@/lib/redis', () => ({ getRedis: () => mockRedis }));
jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { getMarketNews } from '@/app-layer/usecases/trends';

const row = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    source: 'agri-bg',
    category: 'market',
    title: 'Цената на пшеницата',
    summary: 'обзор',
    url: 'https://agri.bg/1',
    imageUrl: null,
    publishedAt: new Date('2026-07-14T09:30:00.000Z'),
    ...over,
});

beforeEach(() => {
    mockFindMany.mockReset();
    mockRedis = null;
});

describe('getMarketNews', () => {
    it('returns the empty shape when no items exist (Redis off)', async () => {
        mockFindMany.mockResolvedValue([]);
        const res = await getMarketNews('all', 50);
        expect(res).toEqual({ category: 'all', items: [] });
        expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it('maps rows to the wire shape with ISO publishedAt, newest first', async () => {
        mockFindMany.mockResolvedValue([row()]);
        const res = await getMarketNews('all', 50);
        expect(res.items[0]).toEqual({
            id: 'n1',
            source: 'agri-bg',
            category: 'market',
            title: 'Цената на пшеницата',
            summary: 'обзор',
            url: 'https://agri.bg/1',
            imageUrl: null,
            publishedAt: '2026-07-14T09:30:00.000Z',
        });
        // Ordered by publishedAt desc.
        expect(mockFindMany.mock.calls[0][0].orderBy).toEqual({ publishedAt: 'desc' });
    });

    it('filters by category when not "all", and leaves it open for "all"', async () => {
        mockFindMany.mockResolvedValue([]);
        await getMarketNews('policy', 50);
        expect(mockFindMany.mock.calls[0][0].where).toEqual({ category: 'policy' });

        mockFindMany.mockClear();
        await getMarketNews('all', 50);
        expect(mockFindMany.mock.calls[0][0].where).toBeUndefined();
    });

    it('bounds the take to the requested limit, capped at 100', async () => {
        mockFindMany.mockResolvedValue([]);
        await getMarketNews('all', 25);
        expect(mockFindMany.mock.calls[0][0].take).toBe(25);

        mockFindMany.mockClear();
        await getMarketNews('all', 500);
        expect(mockFindMany.mock.calls[0][0].take).toBe(100);
    });

    it('serves from the Redis cache without hitting the DB', async () => {
        const cached = JSON.stringify({ category: 'all', items: [row({ publishedAt: '2026-07-14T09:30:00.000Z' })] });
        mockRedis = { get: jest.fn().mockResolvedValue(cached), set: jest.fn() };
        const res = await getMarketNews('all', 50);
        expect(res.items).toHaveLength(1);
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('writes the DB result back to Redis on a miss', async () => {
        mockRedis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
        mockFindMany.mockResolvedValue([row()]);
        await getMarketNews('market', 10);
        expect(mockRedis.set).toHaveBeenCalledWith(
            'trends:news:v1:market:10',
            expect.any(String),
            'EX',
            3600,
        );
    });
});
