/**
 * Home-greeting read-model — the tenant-context DB + the farm-task queue
 * are mocked so we assert the derivation (latest-per-location spray
 * reduction + today's task count), not Prisma.
 */
import type { RequestContext } from '@/app-layer/types';

const db = {
    location: { findMany: jest.fn() },
    weatherObservation: { findMany: jest.fn() },
};
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (d: unknown) => unknown) => cb(db),
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));

// listMyFarmTasks is reused for the tasksToday count — mock its shape.
const listMyFarmTasks = jest.fn();
jest.mock('@/app-layer/usecases/farm-task', () => ({
    listMyFarmTasks: (...args: unknown[]) => listMyFarmTasks(...args),
}));

import { getHomeGreeting } from '@/app-layer/usecases/home-greeting';

const ctx = {
    tenantId: 't1',
    userId: 'u',
    requestId: 'r',
    permissions: { canRead: true, canWrite: true, canAdmin: true, canAudit: true },
} as unknown as RequestContext;

// A spray-GOOD reading (all within DEFAULT_SPRAY_THRESHOLDS), UNSUITABLE
// reading (wind over the drift limit), and a CAUTION reading.
const GOOD = { tempMeanC: 18, precipMm: 0, windMaxKmh: 8 };
const UNSUITABLE = { tempMeanC: 18, precipMm: 0, windMaxKmh: 40 };

/** Build a today-UTC Date with the given hour. */
function todayAt(hour: number): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
}
function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 86_400_000);
}

describe('getHomeGreeting', () => {
    beforeEach(() => {
        db.location.findMany.mockReset();
        db.weatherObservation.findMany.mockReset();
        listMyFarmTasks.mockReset();
        listMyFarmTasks.mockResolvedValue([]);
    });

    it('counts GOOD fields from the LATEST reading per location (recency reduction)', async () => {
        db.location.findMany.mockResolvedValue([{ id: 'L1' }, { id: 'L2' }]);
        // obsDate-desc order: first row per location is its latest. L1's
        // latest is GOOD (an older UNSUITABLE row must be ignored); L2's
        // latest is UNSUITABLE.
        db.weatherObservation.findMany.mockResolvedValue([
            { locationId: 'L1', ...GOOD },        // L1 latest → GOOD
            { locationId: 'L2', ...UNSUITABLE },  // L2 latest → not GOOD
            { locationId: 'L1', ...UNSUITABLE },  // L1 older → ignored
        ]);

        const res = await getHomeGreeting(ctx);

        expect(res.fieldsGoodToSpray).toBe(1);
        expect(res.fieldsWithWeather).toBe(2);
        expect(res.representativeWindKmh).toBe(GOOD.windMaxKmh); // median of [8] → 8
        // No per-location query — exactly ONE weather read across all ids.
        expect(db.weatherObservation.findMany).toHaveBeenCalledTimes(1);
        const arg = db.weatherObservation.findMany.mock.calls[0][0];
        expect(arg.where.tenantId).toBe('t1');
        expect(arg.where.locationId).toEqual({ in: ['L1', 'L2'] });
        expect(arg.orderBy).toEqual({ obsDate: 'desc' });
        expect(arg.take).toBeGreaterThan(0);
    });

    it('representativeWindKmh is the rounded median wind among GOOD fields', async () => {
        db.location.findMany.mockResolvedValue([{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }]);
        db.weatherObservation.findMany.mockResolvedValue([
            { locationId: 'L1', tempMeanC: 18, precipMm: 0, windMaxKmh: 4 },
            { locationId: 'L2', tempMeanC: 18, precipMm: 0, windMaxKmh: 10 },
            { locationId: 'L3', tempMeanC: 18, precipMm: 0, windMaxKmh: 13 },
        ]);

        const res = await getHomeGreeting(ctx);

        expect(res.fieldsGoodToSpray).toBe(3);
        // median of [4, 10, 13] → 10
        expect(res.representativeWindKmh).toBe(10);
    });

    it('handles Prisma Decimal-shaped values via toNumber()', async () => {
        const dec = (n: number) => ({ toNumber: () => n });
        db.location.findMany.mockResolvedValue([{ id: 'L1' }]);
        db.weatherObservation.findMany.mockResolvedValue([
            { locationId: 'L1', tempMeanC: dec(18), precipMm: dec(0), windMaxKmh: dec(9) },
        ]);

        const res = await getHomeGreeting(ctx);
        expect(res.fieldsGoodToSpray).toBe(1);
        expect(res.representativeWindKmh).toBe(9);
    });

    it('counts tasks due today (UTC window), ignoring other days + null dueAt', async () => {
        db.location.findMany.mockResolvedValue([]);
        listMyFarmTasks.mockResolvedValue([
            { id: 'a', dueAt: todayAt(2) },        // today → counts
            { id: 'b', dueAt: todayAt(23) },       // today → counts
            { id: 'c', dueAt: daysFromNow(3) },    // future → no
            { id: 'd', dueAt: daysFromNow(-5) },   // past → no
            { id: 'e', dueAt: null },              // unscheduled → no
        ]);

        const res = await getHomeGreeting(ctx);
        expect(res.tasksToday).toBe(2);
        expect(listMyFarmTasks).toHaveBeenCalledWith(ctx);
    });

    it('pure-GRC / no-ag tenant → zeros + null (no throw)', async () => {
        db.location.findMany.mockResolvedValue([]);
        listMyFarmTasks.mockResolvedValue([]);

        const res = await getHomeGreeting(ctx);
        expect(res).toEqual({
            fieldsGoodToSpray: 0,
            fieldsWithWeather: 0,
            representativeWindKmh: null,
            tasksToday: 0,
        });
        // No locations → the weather query is skipped entirely.
        expect(db.weatherObservation.findMany).not.toHaveBeenCalled();
    });

    it('locations exist but none have weather → zeros + null, denominator 0', async () => {
        db.location.findMany.mockResolvedValue([{ id: 'L1' }]);
        db.weatherObservation.findMany.mockResolvedValue([]);

        const res = await getHomeGreeting(ctx);
        expect(res.fieldsWithWeather).toBe(0);
        expect(res.fieldsGoodToSpray).toBe(0);
        expect(res.representativeWindKmh).toBeNull();
    });
});
