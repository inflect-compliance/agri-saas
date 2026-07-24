/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks/shims. */
/**
 * Unit tests for the getPlantingGdd usecase — loads the right weather
 * window and feeds it to the pure accumulator.
 */
const mockDb: any = {
    planting: { findFirst: jest.fn() },
    weatherObservation: { findMany: jest.fn() },
};

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

import { getPlantingGdd, GDD_BASE_TEMP_C } from '@/app-layer/usecases/agro-gdd';
import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('ADMIN', { tenantId: 'tenant-1' });
const NOW = new Date('2026-06-15T00:00:00Z');

beforeEach(() => jest.clearAllMocks());

describe('getPlantingGdd', () => {
    it('accumulates GDD from sow date over the location weather (base 10)', async () => {
        mockDb.planting.findFirst.mockResolvedValue({
            id: 'p-1',
            sowDate: new Date(Date.UTC(2026, 5, 13)),
            locationId: 'loc-1',
        });
        // Two days: (24+14)/2-10=9 then (26+16)/2-10=11 ⇒ total 20.
        mockDb.weatherObservation.findMany.mockResolvedValue([
            { obsDate: new Date(Date.UTC(2026, 5, 13)), tempMaxC: 24, tempMinC: 14 },
            { obsDate: new Date(Date.UTC(2026, 5, 14)), tempMaxC: 26, tempMinC: 16 },
        ]);

        const r = await getPlantingGdd(ctx, 'p-1', NOW);
        expect(r.baseTempC).toBe(GDD_BASE_TEMP_C);
        expect(r.totalGdd).toBe(20);
        expect(r.days).toHaveLength(2);
        expect(r.days[1].cumulative).toBe(20);
        expect(r.targetGdd).toBeNull();
    });

    it('uses the variety GDD base temp + maturity target when present', async () => {
        mockDb.planting.findFirst.mockResolvedValue({
            id: 'p-cool',
            sowDate: new Date(Date.UTC(2026, 5, 13)),
            locationId: 'loc-1',
            // A cool-season variety: base 4 °C, 500 GDD to maturity.
            variety: { gddBaseC: 4, gddToMaturity: 500 },
        });
        // Base 4 ⇒ (24+14)/2-4=15 then (26+16)/2-4=17 ⇒ total 32.
        mockDb.weatherObservation.findMany.mockResolvedValue([
            { obsDate: new Date(Date.UTC(2026, 5, 13)), tempMaxC: 24, tempMinC: 14 },
            { obsDate: new Date(Date.UTC(2026, 5, 14)), tempMaxC: 26, tempMinC: 16 },
        ]);

        const r = await getPlantingGdd(ctx, 'p-cool', NOW);
        expect(r.baseTempC).toBe(4);
        expect(r.totalGdd).toBe(32);
        expect(r.targetGdd).toBe(500);
    });

    it('returns an empty accumulation when the planting has no sow date', async () => {
        mockDb.planting.findFirst.mockResolvedValue({ id: 'p-2', sowDate: null, locationId: 'loc-1' });
        const r = await getPlantingGdd(ctx, 'p-2', NOW);
        expect(r.totalGdd).toBe(0);
        expect(r.days).toEqual([]);
        // findMany not reached when there's no window.
        expect(mockDb.weatherObservation.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty accumulation when the planting has no location', async () => {
        mockDb.planting.findFirst.mockResolvedValue({
            id: 'p-3',
            sowDate: new Date(Date.UTC(2026, 5, 13)),
            locationId: null,
        });
        const r = await getPlantingGdd(ctx, 'p-3', NOW);
        expect(r.totalGdd).toBe(0);
        expect(r.days).toEqual([]);
    });

    it('skips days missing a temp bound rather than producing NaN', async () => {
        mockDb.planting.findFirst.mockResolvedValue({
            id: 'p-4',
            sowDate: new Date(Date.UTC(2026, 5, 13)),
            locationId: 'loc-1',
        });
        mockDb.weatherObservation.findMany.mockResolvedValue([
            { obsDate: new Date(Date.UTC(2026, 5, 13)), tempMaxC: 24, tempMinC: null }, // skipped
            { obsDate: new Date(Date.UTC(2026, 5, 14)), tempMaxC: 26, tempMinC: 16 }, // 11
        ]);
        const r = await getPlantingGdd(ctx, 'p-4', NOW);
        expect(r.totalGdd).toBe(11);
        expect(r.days).toHaveLength(1);
    });

    it('throws notFound when the planting does not resolve', async () => {
        mockDb.planting.findFirst.mockResolvedValue(null);
        await expect(getPlantingGdd(ctx, 'nope', NOW)).rejects.toMatchObject({});
    });
});
