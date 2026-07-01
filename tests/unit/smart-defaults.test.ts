/**
 * Smart defaults — recall over existing rows. The tenant-context DB is
 * mocked so we assert the recency/regroup mapping, not Prisma. The wizard's
 * pure spray-window evaluator runs for real (it's a pure function).
 */
import { makeRequestContext } from '../helpers/make-context';

const db = {
    parcel: { findMany: jest.fn() },
    operationParcel: { findMany: jest.fn() },
    weatherObservation: { findFirst: jest.fn() },
    planting: { findMany: jest.fn() },
};
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (d: unknown) => unknown) => cb(db),
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));

import { getLocationSmartDefaults } from '@/app-layer/usecases/smart-defaults';

const ctx = makeRequestContext('EDITOR', { tenantId: 't1' });

// A Prisma-Decimal stand-in — carries .toNumber() like the real thing.
const dec = (n: number) => ({ toNumber: () => n });
const d = (iso: string) => new Date(iso);

beforeEach(() => {
    for (const model of Object.values(db)) {
        for (const fn of Object.values(model)) (fn as jest.Mock).mockReset();
    }
});

describe('getLocationSmartDefaults', () => {
    it('regroups the latest job, gives per-parcel recency, default unit, spray window, and next planting', async () => {
        db.parcel.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

        // Op lines newest-first. The latest job is task "job-2" (p1+p2, newest).
        // p2 also has an older line under job-1 with a DIFFERENT product/unit —
        // byParcel must take p2's NEWEST (job-2), proving recency.
        db.operationParcel.findMany
            // first call: lines across all parcels (the bounded reuse query)
            .mockResolvedValueOnce([
                { parcelId: 'p1', taskId: 'job-2', productItemId: 'prodA', doseValue: dec(2.5), doseUnitId: 'unitL', createdAt: d('2026-06-10T00:00:00Z') },
                { parcelId: 'p2', taskId: 'job-2', productItemId: 'prodA', doseValue: dec(2.5), doseUnitId: 'unitL', createdAt: d('2026-06-10T00:00:00Z') },
                { parcelId: 'p2', taskId: 'job-1', productItemId: 'prodB', doseValue: dec(9.9), doseUnitId: 'unitKg', createdAt: d('2026-05-01T00:00:00Z') },
            ])
            // second call: the latest job's lines (where taskId = job-2)
            .mockResolvedValueOnce([
                { parcelId: 'p1', productItemId: 'prodA', doseValue: dec(2.5), doseUnitId: 'unitL', createdAt: d('2026-06-10T00:00:00Z') },
                { parcelId: 'p2', productItemId: 'prodA', doseValue: dec(2.5), doseUnitId: 'unitL', createdAt: d('2026-06-10T00:00:00Z') },
            ]);

        db.weatherObservation.findFirst.mockResolvedValue({
            obsDate: d('2026-06-18T00:00:00Z'),
            windMaxKmh: dec(30), // ≥ 25 ⇒ UNSUITABLE
            precipMm: dec(0),
            tempMeanC: dec(18),
        });

        // Dates are RELATIVE to now so the "soonest FUTURE milestone"
        // assertion never rots as the calendar advances (pl-soon must stay
        // in the future ahead of pl-far).
        const soonPlanting = new Date(Date.now() + 30 * 86_400_000);
        const farPlanting = new Date(Date.now() + 200 * 86_400_000);
        db.planting.findMany.mockResolvedValue([
            { id: 'pl-far', sowDate: farPlanting, transplantDate: null, harvestStartDate: null, variety: { name: 'Late Kale' } },
            { id: 'pl-soon', sowDate: null, transplantDate: soonPlanting, harvestStartDate: null, variety: { name: 'Early Tomato' } },
        ]);

        const res = await getLocationSmartDefaults(ctx, 'loc1');

        // repeatLast — the latest job, regrouped to one product/dose across its parcels.
        expect(res.repeatLast).toEqual({
            parcelIds: ['p1', 'p2'],
            productItemId: 'prodA',
            doseValue: 2.5,
            doseUnitId: 'unitL',
            occurredAt: '2026-06-10T00:00:00.000Z',
        });

        // byParcel — recency: p2 gets prodA (newest), NOT prodB (older job-1).
        expect(res.byParcel).toEqual({
            p1: { productItemId: 'prodA', doseValue: 2.5, doseUnitId: 'unitL' },
            p2: { productItemId: 'prodA', doseValue: 2.5, doseUnitId: 'unitL' },
        });

        // defaultUnitId — unit of the most recent line overall.
        expect(res.defaultUnitId).toBe('unitL');

        // sprayWindow — WeatherObservation passed through evaluateSprayWindow.
        expect(res.sprayWindow?.status).toBe('UNSUITABLE');
        expect(res.sprayWindow?.obsDate).toBe('2026-06-18T00:00:00.000Z');
        expect(res.sprayWindow?.reasons.some((r) => r.includes('Wind'))).toBe(true);

        // nextPlanting — soonest FUTURE milestone (pl-soon's transplant, not
        // pl-far's much later sow).
        expect(res.nextPlanting).toEqual({
            id: 'pl-soon',
            label: 'Early Tomato',
            stage: 'transplant',
            date: soonPlanting.toISOString(),
        });

        // N+1 guard — exactly two operationParcel queries (cross-parcel + the job),
        // never one-per-parcel.
        expect(db.operationParcel.findMany).toHaveBeenCalledTimes(2);
    });

    it('empty tenant → all nulls / empty, no per-parcel queries', async () => {
        db.parcel.findMany.mockResolvedValue([]);
        db.weatherObservation.findFirst.mockResolvedValue(null);
        db.planting.findMany.mockResolvedValue([]);

        const res = await getLocationSmartDefaults(ctx, 'loc1');

        expect(res.repeatLast).toBeNull();
        expect(res.byParcel).toEqual({});
        expect(res.defaultUnitId).toBeNull();
        expect(res.sprayWindow).toBeNull();
        expect(res.nextPlanting).toBeNull();
        // No parcels ⇒ the op-line query is skipped entirely.
        expect(db.operationParcel.findMany).not.toHaveBeenCalled();
    });
});
