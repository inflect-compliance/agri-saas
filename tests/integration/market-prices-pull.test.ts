/**
 * Integration test: market-prices-pull upsert idempotence, against a real DB.
 *
 * The EC HTTP clients are injected (deps.fetchCereal / deps.fetchOilseed) so
 * no network is touched; the DB client is the test-DB client (deps.db). The
 * core invariant: running the pull TWICE with identical source data produces
 * an IDENTICAL row count — the (source,commodity,region,stage) series unique
 * and the (seriesId,date) point unique make every write idempotent.
 */
import { runMarketPricesPull } from '@/app-layer/jobs/market-prices-pull';
import type { EcObservation } from '@/lib/market/ec-agrifood-client';
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import type { PrismaClient } from '@prisma/client';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const wheatObs: EcObservation = {
    memberStateCode: 'BG',
    productName: 'Common wheat',
    stage: 'Delivered to port',
    market: 'Varna',
    beginDate: '06/01/2025',
    price: 178,
    unit: 'EUR/t',
    currency: 'EUR',
};

const sunflowerObs: EcObservation = {
    memberStateCode: 'BG',
    productName: 'Sunflower seed',
    stage: 'CIF',
    market: 'Dobrich',
    beginDate: '06/01/2025',
    price: 512,
    unit: 'BGN/t',
    currency: 'BGN',
};

// Only return records for the requested product; the oilseed fetch returns the
// sunflower record (the job filters productName === 'Sunflower seed').
const deps = {
    fetchCereal: async (args: { productCodes: string[] }): Promise<EcObservation[]> =>
        args.productCodes.includes('BLTPAN') ? [wheatObs] : [],
    fetchOilseed: async (): Promise<EcObservation[]> => [sunflowerObs],
};

describeFn('market-prices-pull (integration — real DB)', () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    beforeEach(async () => {
        // Clean slate — global cache tables, no tenant scoping.
        await prisma.marketPricePoint.deleteMany({});
        await prisma.marketPriceSeries.deleteMany({});
    });

    afterAll(async () => {
        await prisma.marketPricePoint.deleteMany({});
        await prisma.marketPriceSeries.deleteMany({});
    });

    it('persists EC series + points and is idempotent across re-runs', async () => {
        const first = await runMarketPricesPull({ source: 'ec' }, { ...deps, db: prisma });
        expect(first.sources).toEqual(['ec']);

        const seriesAfter1 = await prisma.marketPriceSeries.count();
        const pointsAfter1 = await prisma.marketPricePoint.count();
        // wheat/BG + sunflower/BG.
        expect(seriesAfter1).toBe(2);
        expect(pointsAfter1).toBe(2);

        // Second run with identical data — no new rows.
        await runMarketPricesPull({ source: 'ec' }, { ...deps, db: prisma });
        expect(await prisma.marketPriceSeries.count()).toBe(2);
        expect(await prisma.marketPricePoint.count()).toBe(2);
    });

    it('stores the resolved per-series currency (sunflower BG → BGN)', async () => {
        await runMarketPricesPull({ source: 'ec' }, { ...deps, db: prisma });
        const sunflower = await prisma.marketPriceSeries.findFirst({
            where: { commodity: 'sunflower', region: 'BG' },
            include: { points: true },
        });
        expect(sunflower?.currency).toBe('BGN');
        expect(sunflower?.unit).toBe('BGN/t');
        expect(Number(sunflower?.points[0]?.price)).toBe(512);
    });
});
