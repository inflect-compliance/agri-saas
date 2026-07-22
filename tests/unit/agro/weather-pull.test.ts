/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks/shims. */
/**
 * Unit tests for the weather-pull job — tenant fan-out, per-location
 * lat/lon derivation, weather upsert, and per-location signal eval.
 * The Open-Meteo client + agro-signals usecase are mocked.
 */

// ── global prisma (tenant-list scan + tenant slug + admin membership) ──
const globalPrisma: any = {
    location: { findMany: jest.fn() },
    tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'acme' }) },
    tenantMembership: {
        findFirst: jest.fn().mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' }),
    },
};
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: globalPrisma, prisma: globalPrisma }));

// ── per-tenant tx db (location list + weather upsert) ──
const txDb: any = {
    location: { findMany: jest.fn() },
    weatherObservation: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
};
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(txDb)),
}));

// ── parcel bbox helper (geo.ts) ──
const boundsForLocation = jest.fn();
jest.mock('@/app-layer/repositories/ParcelRepository', () => ({
    ParcelRepository: { boundsForLocation: (...a: any[]) => boundsForLocation(...a) },
}));

// ── Open-Meteo client ──
const fetchDailyWeather = jest.fn();
jest.mock('@/lib/weather/open-meteo-client', () => ({
    fetchDailyWeather: (...a: any[]) => fetchDailyWeather(...a),
}));

// ── agro-signals usecase ──
const evaluateLocationSignals = jest.fn().mockResolvedValue({ created: 1 });
jest.mock('@/app-layer/usecases/agro-signals', () => ({
    evaluateLocationSignals: (...a: any[]) => evaluateLocationSignals(...a),
}));

import { runWeatherPull } from '@/app-layer/jobs/weather-pull';

const DAYS = [
    {
        date: '2026-06-14', tempMaxC: 24, tempMinC: 14, tempMeanC: null, precipMm: 1, windMaxKmh: 8, humidityMean: 80,
        hours: [{ hour: 6, windKmh: 7, precipMm: 0, tempC: 16 }], utcOffsetSeconds: 7200,
    },
    {
        date: '2026-06-15', tempMaxC: 25, tempMinC: 15, tempMeanC: 20, precipMm: 0, windMaxKmh: 9, humidityMean: 82,
        hours: [{ hour: 7, windKmh: 8, precipMm: 0, tempC: 18 }], utcOffsetSeconds: 7200,
    },
];

beforeEach(() => {
    jest.clearAllMocks();
    globalPrisma.tenant.findUnique.mockResolvedValue({ slug: 'acme' });
    globalPrisma.tenantMembership.findFirst.mockResolvedValue({ userId: 'admin-1', role: 'ADMIN' });
    fetchDailyWeather.mockResolvedValue(DAYS);
    evaluateLocationSignals.mockResolvedValue({ created: 1 });
});

describe('runWeatherPull — scoped to one tenant', () => {
    it('derives a parcel-bbox centroid, upserts weather, evaluates signals', async () => {
        boundsForLocation.mockResolvedValue([-1.21, 52.19, -1.19, 52.21]); // [w,s,e,n]
        txDb.location.findMany.mockResolvedValue([{ id: 'loc-1', name: 'Home Field', boundsJson: null }]);

        const r = await runWeatherPull({ tenantId: 'tenant-1' });

        // Centroid of the bbox = (52.20, -1.20).
        expect(fetchDailyWeather).toHaveBeenCalledWith(52.2, -1.2);
        // One upsert per day, keyed by (tenant, location, obsDate).
        expect(txDb.weatherObservation.upsert).toHaveBeenCalledTimes(2);
        const firstUpsert = txDb.weatherObservation.upsert.mock.calls[0][0];
        expect(firstUpsert.where.tenantId_locationId_obsDate.locationId).toBe('loc-1');
        // tempMeanC filled from (max+min)/2 when the API omits it (day 1).
        expect(firstUpsert.create.tempMeanC).toBe(19);
        // Hourly series + UTC offset persisted for the hourly spray-window.
        expect(firstUpsert.create.hourlyJson).toEqual([{ hour: 6, windKmh: 7, precipMm: 0, tempC: 16 }]);
        expect(firstUpsert.create.utcOffsetSeconds).toBe(7200);
        // Signal eval ran for the processed location.
        expect(evaluateLocationSignals).toHaveBeenCalledWith(expect.anything(), 'loc-1');
        expect(r.scanned).toBe(1);
        expect(r.created).toBe(2);
        expect(r.signals).toBe(1);
        expect(r.tenants).toBe(1);
    });

    it('falls back to Location.boundsJson when there are no parcels', async () => {
        boundsForLocation.mockResolvedValue(null);
        txDb.location.findMany.mockResolvedValue([
            { id: 'loc-2', name: 'Far Field', boundsJson: [-2.0, 51.0, -1.0, 52.0] },
        ]);

        await runWeatherPull({ tenantId: 'tenant-1' });
        // Centroid of [-2,51,-1,52] = (51.5, -1.5).
        expect(fetchDailyWeather).toHaveBeenCalledWith(51.5, -1.5);
    });

    it('skips a location with neither parcels nor boundsJson (no coords)', async () => {
        boundsForLocation.mockResolvedValue(null);
        txDb.location.findMany.mockResolvedValue([{ id: 'loc-3', name: 'Unmapped', boundsJson: null }]);

        const r = await runWeatherPull({ tenantId: 'tenant-1' });
        expect(fetchDailyWeather).not.toHaveBeenCalled();
        expect(evaluateLocationSignals).not.toHaveBeenCalled();
        expect(r.scanned).toBe(0);
    });

    it('continues to signal eval even when a fetch throws for one location', async () => {
        boundsForLocation.mockResolvedValue([-1.21, 52.19, -1.19, 52.21]);
        txDb.location.findMany.mockResolvedValue([{ id: 'loc-1', name: 'Home Field', boundsJson: null }]);
        fetchDailyWeather.mockRejectedValue(new Error('network'));

        const r = await runWeatherPull({ tenantId: 'tenant-1' });
        // No upserts (fetch failed) and the location isn't queued for eval.
        expect(txDb.weatherObservation.upsert).not.toHaveBeenCalled();
        expect(evaluateLocationSignals).not.toHaveBeenCalled();
        expect(r.created).toBe(0);
    });
});

describe('runWeatherPull — all-tenants fan-out', () => {
    it('resolves the distinct tenant list when no tenantId is given', async () => {
        globalPrisma.location.findMany.mockResolvedValue([{ tenantId: 'tenant-1' }, { tenantId: 'tenant-2' }]);
        boundsForLocation.mockResolvedValue(null);
        txDb.location.findMany.mockResolvedValue([]);

        const r = await runWeatherPull({});
        expect(globalPrisma.location.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ distinct: ['tenantId'] }),
        );
        expect(r.tenants).toBe(2);
    });

    it('skips a tenant with no active OWNER/ADMIN membership', async () => {
        globalPrisma.location.findMany.mockResolvedValue([{ tenantId: 'tenant-1' }]);
        globalPrisma.tenantMembership.findFirst.mockResolvedValue(null);

        const r = await runWeatherPull({});
        expect(txDb.location.findMany).not.toHaveBeenCalled();
        expect(r.scanned).toBe(0);
    });
});
