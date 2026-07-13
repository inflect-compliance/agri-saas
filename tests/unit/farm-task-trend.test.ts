/**
 * getFarmTaskTrend — daily "created vs completed" bucketing for the
 * dashboard trendline. Pure aggregation over the repository rows; the DB is
 * mocked so this asserts the bucketing/window logic only.
 */
const farmTaskTrendRows = jest.fn();

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (db: unknown) => unknown) => cb({}),
}));
jest.mock('@/app-layer/repositories/WorkItemRepository', () => ({
    WorkItemRepository: {
        farmTaskTrendRows: (...args: unknown[]) => farmTaskTrendRows(...args),
    },
}));

import { getFarmTaskTrend } from '@/app-layer/usecases/farm-task';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = { tenantId: 't1', userId: 'u1' } as any;

describe('getFarmTaskTrend', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-13T10:00:00Z'));
        farmTaskTrendRows.mockReset();
    });
    afterEach(() => jest.useRealTimers());

    it('returns `days` daily buckets ending today, all zero with no rows', async () => {
        farmTaskTrendRows.mockResolvedValue([]);
        const trend = await getFarmTaskTrend(ctx, 14);
        expect(trend).toHaveLength(14);
        expect(trend[0].date).toBe('2026-06-30');
        expect(trend[13].date).toBe('2026-07-13');
        expect(trend.every((p) => p.created === 0 && p.completed === 0)).toBe(true);
    });

    it('buckets created and completed by their own UTC day', async () => {
        farmTaskTrendRows.mockResolvedValue([
            // created today, not yet completed
            { createdAt: new Date('2026-07-13T08:00:00Z'), completedAt: null },
            // created yesterday (just before midnight), completed today
            { createdAt: new Date('2026-07-12T23:30:00Z'), completedAt: new Date('2026-07-13T09:00:00Z') },
            // created BEFORE the window, completed in-window → completed only
            { createdAt: new Date('2026-06-01T00:00:00Z'), completedAt: new Date('2026-07-11T00:00:00Z') },
        ]);
        const trend = await getFarmTaskTrend(ctx, 14);
        const byDate = Object.fromEntries(trend.map((p) => [p.date, p]));
        expect(byDate['2026-07-13'].created).toBe(1);
        expect(byDate['2026-07-13'].completed).toBe(1);
        expect(byDate['2026-07-12'].created).toBe(1);
        expect(byDate['2026-07-11'].completed).toBe(1);
        // The out-of-window created row lands in completed only.
        expect(trend.reduce((s, p) => s + p.created, 0)).toBe(2);
        expect(trend.reduce((s, p) => s + p.completed, 0)).toBe(2);
    });

    it('clamps the window to [7, 60] days (default 14)', async () => {
        farmTaskTrendRows.mockResolvedValue([]);
        expect(await getFarmTaskTrend(ctx, 2)).toHaveLength(7);
        expect(await getFarmTaskTrend(ctx, 1000)).toHaveLength(60);
        expect(await getFarmTaskTrend(ctx)).toHaveLength(14);
    });

    it('passes the window-start Date to the repository', async () => {
        farmTaskTrendRows.mockResolvedValue([]);
        await getFarmTaskTrend(ctx, 14);
        const since = farmTaskTrendRows.mock.calls[0][2] as Date;
        expect(since.toISOString()).toBe('2026-06-30T00:00:00.000Z');
    });
});
