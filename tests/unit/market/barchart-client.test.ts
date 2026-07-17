import {
    fetchBarchartQuotes,
    BarchartRateLimitError,
    BARCHART_CONTRACTS,
} from '@/lib/market/barchart-client';

function stubFetch(body: unknown, status = 200): typeof fetch {
    return (async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
}

describe('fetchBarchartQuotes', () => {
    it('parses the documented getQuote results shape', async () => {
        const fetchImpl = stubFetch({
            status: { code: 200, message: 'Success.' },
            results: [
                {
                    symbol: 'MLU26',
                    name: "Milling Wheat Sep '26",
                    lastPrice: 198.75,
                    tradeTimestamp: '2026-07-16T16:30:00+02:00',
                    mode: 'd',
                },
                {
                    symbol: 'EMAU26',
                    name: "Corn Aug '26",
                    lastPrice: '205.25', // Barchart can serialise numbers as strings
                    tradeTimestamp: '2026-07-16T16:30:00+02:00',
                    mode: 'd',
                },
            ],
        });

        const quotes = await fetchBarchartQuotes(['ML*0', 'EMA*0'], 'demo-key', { fetchImpl });

        expect(quotes).toEqual([
            {
                symbol: 'MLU26',
                name: "Milling Wheat Sep '26",
                lastPrice: 198.75,
                tradeTimestamp: '2026-07-16T16:30:00+02:00',
                mode: 'd',
            },
            {
                symbol: 'EMAU26',
                name: "Corn Aug '26",
                lastPrice: 205.25,
                tradeTimestamp: '2026-07-16T16:30:00+02:00',
                mode: 'd',
            },
        ]);
    });

    it('returns [] without a network call when no symbols are requested', async () => {
        const fetchImpl = jest.fn();
        const quotes = await fetchBarchartQuotes([], 'k', {
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        expect(quotes).toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('treats an empty result (status 204) as no quotes, not an error', async () => {
        const quotes = await fetchBarchartQuotes(['ZZ*0'], 'k', {
            fetchImpl: stubFetch({ status: { code: 204, message: 'No data.' } }),
        });
        expect(quotes).toEqual([]);
    });

    it('nulls a non-numeric lastPrice so the caller skips it', async () => {
        const quotes = await fetchBarchartQuotes(['ML*0'], 'k', {
            fetchImpl: stubFetch({
                status: { code: 200 },
                results: [{ symbol: 'MLU26', lastPrice: 'N/A' }],
            }),
        });
        expect(quotes[0].lastPrice).toBeNull();
    });

    it('throws BarchartRateLimitError on HTTP 429', async () => {
        await expect(
            fetchBarchartQuotes(['ML*0'], 'k', { fetchImpl: stubFetch({}, 429) }),
        ).rejects.toBeInstanceOf(BarchartRateLimitError);
    });

    it('throws BarchartRateLimitError on an API status 429/509 body', async () => {
        await expect(
            fetchBarchartQuotes(['ML*0'], 'k', {
                fetchImpl: stubFetch({ status: { code: 429, message: 'Too many requests.' } }),
            }),
        ).rejects.toBeInstanceOf(BarchartRateLimitError);
    });

    it('throws a plain Error on a non-2xx HTTP status', async () => {
        await expect(
            fetchBarchartQuotes(['ML*0'], 'k', { fetchImpl: stubFetch({}, 500) }),
        ).rejects.toThrow(/HTTP 500/);
    });
});

describe('BARCHART_CONTRACTS', () => {
    it('defaults to MATIF EUR/t contracts on existing commodities so they render with no UI change', () => {
        expect(BARCHART_CONTRACTS.length).toBeGreaterThan(0);
        for (const c of BARCHART_CONTRACTS) {
            expect(c.region).toBe('MATIF');
            expect(c.currency).toBe('EUR');
            expect(c.unit).toBe('EUR/t');
            // Active defaults overlap the Trends picker commodities.
            expect(['wheat', 'maize']).toContain(c.commodity);
        }
    });
});
