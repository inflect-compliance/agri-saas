/**
 * Season recap — aggregation math + scoping + tenant-scoping assertions.
 * The tenant-context DB is mocked so we assert the mapping, not Prisma.
 */
import type { RequestContext } from '@/app-layer/types';

const db = {
    season: { findFirst: jest.fn(), findMany: jest.fn() },
    yieldRecord: { findMany: jest.fn() },
    parcel: { findMany: jest.fn() },
    logEntry: { count: jest.fn(), aggregate: jest.fn() },
    location: { findMany: jest.fn() },
};

// Capture the where-clauses passed to each query so we can assert
// tenant-scoping + season-scoping structurally.
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: (_ctx: unknown, cb: (d: unknown) => unknown) => cb(db),
}));
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Farm' }) } },
}));

// year-on-farm.ts statically imports the certification derivation; mock
// it disabled (empty module list) so the smoke test never hits the
// scheme/readiness queries.
jest.mock('@/app-layer/usecases/modules', () => ({
    getEnabledModules: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/app-layer/usecases/certification-scheme', () => ({
    listSchemes: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/app-layer/usecases/framework/coverage', () => ({
    generateReadinessReport: jest.fn(),
}));

import { getSeasonRecap } from '@/app-layer/usecases/season-recap';

const ctx = { tenantId: 't1', userId: 'u', requestId: 'r', permissions: { canRead: true } } as unknown as RequestContext;

/** Reset all mocks to an "empty tenant" baseline. */
function resetEmpty() {
    db.season.findFirst.mockReset().mockResolvedValue(null);
    db.season.findMany.mockReset().mockResolvedValue([]);
    db.yieldRecord.findMany.mockReset().mockResolvedValue([]);
    db.parcel.findMany.mockReset().mockResolvedValue([]);
    db.logEntry.count.mockReset().mockResolvedValue(0);
    db.logEntry.aggregate.mockReset().mockResolvedValue({ _sum: { costAmount: null }, _count: { costAmount: 0 } });
    db.location.findMany.mockReset().mockResolvedValue([]);
}

const SEASON = { id: 's1', name: '2026 Main', year: 2026, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') };

describe('getSeasonRecap', () => {
    beforeEach(resetEmpty);

    it('empty tenant → zeros, nulls, empty topFields', async () => {
        const r = await getSeasonRecap(ctx);
        expect(r).toEqual({
            seasonId: null,
            seasonName: null,
            year: null,
            totalAreaHa: 0,
            totalYieldTonnes: 0,
            avgYieldTPerHa: null,
            costPerHa: null,
            topFields: [],
            activityCount: 0,
        });
    });

    it('avg t/ha = totalYield / totalArea', async () => {
        db.season.findMany.mockResolvedValue([SEASON]);
        db.yieldRecord.findMany.mockResolvedValue([
            { locationId: 'locA', grossTonnes: '100' },
            { locationId: 'locA', grossTonnes: '50' },
        ]);
        db.parcel.findMany.mockResolvedValue([{ locationId: 'locA', areaHa: '30' }]);
        db.location.findMany.mockResolvedValue([{ id: 'locA', name: 'North Field' }]);

        const r = await getSeasonRecap(ctx);
        expect(r.totalYieldTonnes).toBe(150);
        expect(r.totalAreaHa).toBe(30);
        expect(r.avgYieldTPerHa).toBe(5); // 150 / 30
        expect(r.seasonId).toBe('s1');
        expect(r.seasonName).toBe('2026 Main');
        expect(r.year).toBe(2026);
    });

    it('avgYieldTPerHa is null when total area is 0', async () => {
        db.season.findMany.mockResolvedValue([SEASON]);
        db.yieldRecord.findMany.mockResolvedValue([{ locationId: 'locA', grossTonnes: '100' }]);
        db.parcel.findMany.mockResolvedValue([]); // no parcels → 0 area
        db.location.findMany.mockResolvedValue([{ id: 'locA', name: 'North Field' }]);

        const r = await getSeasonRecap(ctx);
        expect(r.totalAreaHa).toBe(0);
        expect(r.avgYieldTPerHa).toBeNull();
    });

    it('costPerHa is null when there are NO costAmount rows', async () => {
        db.season.findMany.mockResolvedValue([SEASON]);
        db.yieldRecord.findMany.mockResolvedValue([{ locationId: 'locA', grossTonnes: '100' }]);
        db.parcel.findMany.mockResolvedValue([{ locationId: 'locA', areaHa: '10' }]);
        db.location.findMany.mockResolvedValue([{ id: 'locA', name: 'North' }]);
        db.logEntry.aggregate.mockResolvedValue({ _sum: { costAmount: null }, _count: { costAmount: 0 } });

        const r = await getSeasonRecap(ctx);
        expect(r.costPerHa).toBeNull();
    });

    it('costPerHa = sum(costAmount) / totalArea when cost rows present', async () => {
        db.season.findMany.mockResolvedValue([SEASON]);
        db.yieldRecord.findMany.mockResolvedValue([{ locationId: 'locA', grossTonnes: '100' }]);
        db.parcel.findMany.mockResolvedValue([{ locationId: 'locA', areaHa: '20' }]);
        db.location.findMany.mockResolvedValue([{ id: 'locA', name: 'North' }]);
        db.logEntry.aggregate.mockResolvedValue({ _sum: { costAmount: '400' }, _count: { costAmount: 3 } });

        const r = await getSeasonRecap(ctx);
        expect(r.costPerHa).toBe(20); // 400 / 20
    });

    it('topFields sorted by yield desc and capped at 3', async () => {
        db.season.findMany.mockResolvedValue([SEASON]);
        db.yieldRecord.findMany.mockResolvedValue([
            { locationId: 'a', grossTonnes: '10' },
            { locationId: 'b', grossTonnes: '50' },
            { locationId: 'c', grossTonnes: '30' },
            { locationId: 'd', grossTonnes: '40' },
            { locationId: 'e', grossTonnes: '5' },
        ]);
        db.parcel.findMany.mockResolvedValue([
            { locationId: 'b', areaHa: '10' },
        ]);
        db.location.findMany.mockResolvedValue([
            { id: 'b', name: 'B field' },
            { id: 'd', name: 'D field' },
            { id: 'c', name: 'C field' },
        ]);

        const r = await getSeasonRecap(ctx);
        expect(r.topFields).toHaveLength(3);
        expect(r.topFields.map((f) => f.locationId)).toEqual(['b', 'd', 'c']);
        expect(r.topFields.map((f) => f.yieldTonnes)).toEqual([50, 40, 30]);
        // tPerHa computed where area is known (b: 50/10), null otherwise.
        expect(r.topFields[0]).toMatchObject({ name: 'B field', areaHa: 10, tPerHa: 5 });
        expect(r.topFields[1].areaHa).toBeNull();
        expect(r.topFields[1].tPerHa).toBeNull();
    });

    it('scopes by the provided seasonId and every query filters by tenantId', async () => {
        db.season.findFirst.mockResolvedValue(SEASON);
        db.yieldRecord.findMany.mockResolvedValue([{ locationId: 'locA', grossTonnes: '10' }]);
        db.parcel.findMany.mockResolvedValue([{ locationId: 'locA', areaHa: '2' }]);
        db.location.findMany.mockResolvedValue([{ id: 'locA', name: 'North' }]);

        await getSeasonRecap(ctx, 's1');

        // seasonId path uses findFirst (not the most-recent findMany).
        expect(db.season.findFirst).toHaveBeenCalledTimes(1);
        expect(db.season.findMany).not.toHaveBeenCalled();
        expect(db.season.findFirst.mock.calls[0][0].where).toMatchObject({ id: 's1', tenantId: 't1' });

        // YieldRecord filtered by tenantId AND the season FK.
        const yieldWhere = db.yieldRecord.findMany.mock.calls[0][0].where;
        expect(yieldWhere).toMatchObject({ tenantId: 't1', seasonId: 's1' });

        // LogEntry count + aggregate both filter by tenantId + the season window.
        const countWhere = db.logEntry.count.mock.calls[0][0].where;
        expect(countWhere.tenantId).toBe('t1');
        expect(countWhere.occurredAt).toMatchObject({ gte: SEASON.startDate, lte: SEASON.endDate });
        const aggWhere = db.logEntry.aggregate.mock.calls[0][0].where;
        expect(aggWhere.tenantId).toBe('t1');

        // Parcel + Location reads tenant-scoped.
        expect(db.parcel.findMany.mock.calls[0][0].where.tenantId).toBe('t1');
        expect(db.location.findMany.mock.calls[0][0].where.tenantId).toBe('t1');
    });

    it('all-time scope (no seasons) → null season fields, all-tenant parcels, no occurredAt filter', async () => {
        db.season.findMany.mockResolvedValue([]); // no seasons
        db.yieldRecord.findMany.mockResolvedValue([{ locationId: 'locA', grossTonnes: '8' }]);
        db.parcel.findMany.mockResolvedValue([{ locationId: 'locA', areaHa: '4' }]);
        db.location.findMany.mockResolvedValue([{ id: 'locA', name: 'North' }]);

        const r = await getSeasonRecap(ctx);
        expect(r.seasonId).toBeNull();
        expect(r.seasonName).toBeNull();
        expect(r.year).toBeNull();

        // No season → YieldRecord where has no seasonId key.
        expect(db.yieldRecord.findMany.mock.calls[0][0].where.seasonId).toBeUndefined();
        // No season → LogEntry where has no occurredAt window.
        expect(db.logEntry.count.mock.calls[0][0].where.occurredAt).toBeUndefined();
        // All-tenant parcels → no locationId filter.
        expect(db.parcel.findMany.mock.calls[0][0].where.locationId).toBeUndefined();
    });
});

describe('generateYearOnFarmPdf (smoke)', () => {
    beforeEach(resetEmpty);

    it('returns a PDFKit document for an empty tenant without throwing', async () => {
        const { generateYearOnFarmPdf } = await import('@/app-layer/reports/pdf/year-on-farm');
        const doc = await generateYearOnFarmPdf(ctx);
        expect(doc).toBeTruthy();
        expect(typeof (doc as PDFKit.PDFDocument).end).toBe('function');
        // Finalise so the stream is not left dangling.
        (doc as PDFKit.PDFDocument).end();
    });
});
