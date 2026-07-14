import {
    fetchAlphaVantageCommodity,
    AlphaVantageRateLimitError,
} from '@/lib/market/alpha-vantage-client';

function stubFetch(body: unknown, status = 200): typeof fetch {
    return (async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
}

describe('fetchAlphaVantageCommodity', () => {
    it('parses the documented { data:[{date,value}] } shape (USD)', async () => {
        const fetchImpl = stubFetch({
            name: 'Global Price of Wheat',
            interval: 'monthly',
            unit: 'USD per metric ton',
            data: [
                { date: '2025-01-01', value: '250.5' },
                { date: '2024-12-01', value: '248.0' },
                { date: '2024-11-01', value: '.' }, // AV's missing-value sentinel
            ],
        });

        const series = await fetchAlphaVantageCommodity('WHEAT', 'demo-key', { fetchImpl });

        expect(series.currency).toBe('USD');
        expect(series.unit).toBe('USD per metric ton');
        expect(series.observations).toEqual([
            { date: '2025-01-01', value: 250.5 },
            { date: '2024-12-01', value: 248 },
            { date: '2024-11-01', value: null }, // "." → null (caller skips)
        ]);
    });

    it('defaults the unit to USD/t when the body omits it', async () => {
        const series = await fetchAlphaVantageCommodity('CORN', 'k', {
            fetchImpl: stubFetch({ data: [{ date: '2025-01-01', value: '190' }] }),
        });
        expect(series.unit).toBe('USD/t');
    });

    it('throws AlphaVantageRateLimitError on a Note/Information throttle body', async () => {
        await expect(
            fetchAlphaVantageCommodity('WHEAT', 'k', {
                fetchImpl: stubFetch({ Information: 'Our standard API rate limit is 25 requests per day.' }),
            }),
        ).rejects.toBeInstanceOf(AlphaVantageRateLimitError);
    });

    it('throws AlphaVantageRateLimitError on HTTP 429', async () => {
        await expect(
            fetchAlphaVantageCommodity('WHEAT', 'k', { fetchImpl: stubFetch({}, 429) }),
        ).rejects.toBeInstanceOf(AlphaVantageRateLimitError);
    });
});
