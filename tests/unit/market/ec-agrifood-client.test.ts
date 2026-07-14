import { fetchCerealPrices, fetchOilseedPrices } from '@/lib/market/ec-agrifood-client';

/** Build a stub fetch returning `body` as JSON, recording the requested URL. */
function stubFetch(body: unknown): { fetchImpl: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
        urls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => body,
            text: async () => JSON.stringify(body),
        } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, urls };
}

describe('fetchCerealPrices', () => {
    it('normalises a cereals record (comma-decimal, always EUR, EUR/t)', async () => {
        const { fetchImpl, urls } = stubFetch([
            {
                memberStateCode: 'BG',
                memberStateName: 'Bulgaria',
                beginDate: '06/01/2025',
                endDate: '12/01/2025',
                price: '€178,00',
                unit: 'TONNES',
                weekNumber: 2,
                productName: 'Common wheat (bread milling)',
                marketName: 'Varna',
                stageName: 'Delivered to port',
                referencePeriod: '2024/2025',
            },
        ]);

        const obs = await fetchCerealPrices(
            { memberStateCodes: ['BG', 'RO', 'EL'], productCodes: ['BLTPAN'], years: [2025] },
            { baseUrl: 'https://ec.test/api', fetchImpl },
        );

        expect(obs).toHaveLength(1);
        expect(obs[0]).toMatchObject({
            memberStateCode: 'BG',
            price: 178,
            currency: 'EUR',
            unit: 'EUR/t',
            stage: 'Delivered to port',
            market: 'Varna',
            beginDate: '06/01/2025',
            productName: 'Common wheat (bread milling)',
        });
        // Query must filter by product + member states (responses are huge).
        expect(urls[0]).toContain('/cereal/prices?');
        expect(urls[0]).toContain('productCodes=BLTPAN');
        expect(urls[0]).toContain('memberStateCodes=BG%2CRO%2CEL');
    });

    it('yields a null price for a non-numeric value (caller skips the row)', async () => {
        const { fetchImpl } = stubFetch([
            { memberStateCode: 'RO', beginDate: '06/01/2025', price: ':', productName: 'Feed maize' },
        ]);
        const obs = await fetchCerealPrices(
            { memberStateCodes: ['RO'], productCodes: ['MAI'], years: [2025] },
            { fetchImpl },
        );
        expect(obs[0].price).toBeNull();
    });
});

describe('fetchOilseedPrices', () => {
    it('normalises an oilseed record (DIFFERENT keys, dot-decimal, BG→BGN, BGN/t)', async () => {
        const { fetchImpl, urls } = stubFetch([
            {
                memberStateCode: 'BG',
                beginDate: '06/01/2025',
                endDate: '12/01/2025',
                price: '€512.00', // DOT decimal + misleading € glyph
                unit: 'national currency/ton',
                product: 'Sunflower seed', // NOT productName
                market: 'Dobrich', // NOT marketName
                marketStage: 'CIF', // NOT stageName
                marketingYear: '2024/2025', // NOT referencePeriod
            },
        ]);

        const obs = await fetchOilseedPrices(
            { memberStateCodes: ['BG'], years: [2025] },
            { baseUrl: 'https://ec.test/api', fetchImpl },
        );

        expect(obs).toHaveLength(1);
        expect(obs[0]).toMatchObject({
            memberStateCode: 'BG',
            productName: 'Sunflower seed',
            price: 512,
            currency: 'BGN', // resolved from region, NOT the € glyph
            unit: 'BGN/t',
            stage: 'CIF',
            market: 'Dobrich',
        });
        // Plural /oilseeds/ endpoint (singular 404s).
        expect(urls[0]).toContain('/oilseeds/prices?');
    });

    it('resolves a Romanian oilseed price to RON', async () => {
        const { fetchImpl } = stubFetch([
            { memberStateCode: 'RO', beginDate: '06/01/2025', price: '€2.400,50', product: 'Sunflower seed' },
        ]);
        const obs = await fetchOilseedPrices({ memberStateCodes: ['RO'], years: [2025] }, { fetchImpl });
        expect(obs[0].currency).toBe('RON');
        expect(obs[0].unit).toBe('RON/t');
        expect(obs[0].price).toBe(2400.5);
    });
});

describe('EC client error handling', () => {
    it('throws on a non-2xx response', async () => {
        const fetchImpl = (async () => ({
            ok: false,
            status: 503,
            json: async () => ({}),
            text: async () => 'unavailable',
        })) as unknown as typeof fetch;
        await expect(
            fetchCerealPrices(
                { memberStateCodes: ['BG'], productCodes: ['BLTPAN'], years: [2025] },
                { fetchImpl },
            ),
        ).rejects.toThrow(/EC AGRI-food error 503/);
    });
});
