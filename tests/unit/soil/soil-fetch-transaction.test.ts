/**
 * Regression — the soil-fetch PROVIDER call must run OUTSIDE the Prisma
 * interactive transaction.
 *
 * Holding a tenant transaction open across the SoilGrids network round-trip
 * blew Prisma's 5 s interactive-transaction cap ("A query cannot be executed
 * on an expired transaction"), so the SoilSample upsert failed and every
 * parcel stayed stuck on "soil pending" with an empty cache. `fetchAndStore-
 * ParcelSoil` now brackets the network call with two SHORT transactions
 * (resolve → fetch → persist). This test pins that ordering.
 */

// txDepth is incremented for the duration of every runInTenantContext callback,
// so the fetch mock can record whether a transaction was open when it ran.
let txDepth = 0;
let fetchTxDepthAtCall = -1;

const mockCentroid = jest.fn<Promise<{ lon: number; lat: number } | null>, unknown[]>(
    async () => ({ lon: 25.0, lat: 42.0 }),
);
const mockFindUnique = jest.fn<Promise<unknown>, unknown[]>(async () => null);
const mockUpsert = jest.fn(async () => ({}));
const mockUpdateMany = jest.fn(async () => ({ count: 1 }));

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: unknown, cb: (db: unknown) => unknown) => {
        txDepth++;
        try {
            return await cb({
                soilSample: { findUnique: mockFindUnique, upsert: mockUpsert },
                parcel: { updateMany: mockUpdateMany },
            });
        } finally {
            txDepth--;
        }
    }),
}));

jest.mock('@/app-layer/repositories/ParcelRepository', () => ({
    ParcelRepository: { centroidLonLat: (...a: unknown[]) => mockCentroid(...a) },
}));

const mockFetchSoilProfile = jest.fn(async () => {
    fetchTxDepthAtCall = txDepth; // capture the transaction depth at call time
    return { textureClass: 'clay', wrbClass: 'Chernozem', phH2o: 6.8 };
});
jest.mock('@/lib/soil/soilgrids-client', () => ({
    fetchSoilProfile: (...a: unknown[]) => mockFetchSoilProfile(...(a as [])),
}));

jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn(async () => {}) }));
jest.mock('@/env', () => ({ env: { SOIL_PROVIDER: 'soilgrids', SOIL_BASE_URL: undefined } }));
jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { fetchAndStoreParcelSoil } from '@/app-layer/usecases/soil';
import { runInTenantContext } from '@/lib/db-context';
import { makeRequestContext } from '../../helpers/make-context';

describe('fetchAndStoreParcelSoil — provider call runs outside the DB transaction', () => {
    const ctx = makeRequestContext('ADMIN', { tenantId: 'tenant-soil' });

    beforeEach(() => {
        txDepth = 0;
        fetchTxDepthAtCall = -1;
        jest.clearAllMocks();
        mockCentroid.mockResolvedValue({ lon: 25.0, lat: 42.0 });
        mockFindUnique.mockResolvedValue(null);
    });

    it('fetches the profile with NO transaction open, then persists (two short txns)', async () => {
        const res = await fetchAndStoreParcelSoil(ctx, 'parcel-1');

        // The invariant: the network call happened with zero open transactions.
        expect(fetchTxDepthAtCall).toBe(0);
        expect(res.status).toBe('fetched');
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        expect(mockUpdateMany).toHaveBeenCalledTimes(1);
        // resolve + persist = two separate tenant transactions bracketing the fetch.
        expect((runInTenantContext as jest.Mock).mock.calls).toHaveLength(2);
    });

    it('reuses a cache hit and skips the provider call entirely', async () => {
        mockFindUnique.mockResolvedValue({
            provider: 'soilgrids',
            dataJson: { textureClass: 'silt', wrbClass: null, phH2o: 7.0 },
        });
        const res = await fetchAndStoreParcelSoil(ctx, 'parcel-1');

        expect(mockFetchSoilProfile).not.toHaveBeenCalled();
        expect(res.status).toBe('cached');
        expect(mockUpsert).not.toHaveBeenCalled();
        expect(mockUpdateMany).toHaveBeenCalledTimes(1); // still stamps the parcel
    });

    it('skips (no write, no fetch) when the parcel has no centroid', async () => {
        mockCentroid.mockResolvedValue(null);
        const res = await fetchAndStoreParcelSoil(ctx, 'parcel-1');

        expect(res).toEqual({ status: 'skipped', reason: 'no-centroid' });
        expect(mockFetchSoilProfile).not.toHaveBeenCalled();
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });
});
