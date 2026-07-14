/**
 * Unit tests for the Open-Meteo daily-forecast client.
 * Pure HTTP — the global `fetch` is mocked. No DB.
 */
import { fetchDailyWeather } from '@/lib/weather/open-meteo-client';

const realFetch = global.fetch;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body),
        text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    }) as unknown as typeof fetch;
}

afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
});

describe('fetchDailyWeather', () => {
    it('zips the parallel daily.* arrays into one row per day', async () => {
        mockFetchOnce({
            utc_offset_seconds: 7200,
            daily: {
                time: ['2026-06-10', '2026-06-11'],
                temperature_2m_max: [24, 25],
                temperature_2m_min: [12, 13],
                temperature_2m_mean: [18, 19],
                precipitation_sum: [0, 3.2],
                wind_speed_10m_max: [10, 28],
                relative_humidity_2m_mean: [80, 91],
            },
        });

        const rows = await fetchDailyWeather(52.2, -1.2);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            date: '2026-06-10',
            tempMaxC: 24,
            tempMinC: 12,
            tempMeanC: 18,
            precipMm: 0,
            windMaxKmh: 10,
            humidityMean: 80,
            hours: [],
            utcOffsetSeconds: 7200,
        });
        expect(rows[1].precipMm).toBe(3.2);
        expect(rows[1].windMaxKmh).toBe(28);
    });

    it('groups the hourly.* series into per-day location-local hours', async () => {
        mockFetchOnce({
            utc_offset_seconds: 10800,
            daily: {
                time: ['2026-06-10', '2026-06-11'],
                temperature_2m_max: [24, 25],
                temperature_2m_min: [12, 13],
                temperature_2m_mean: [18, 19],
                precipitation_sum: [0, 0],
                wind_speed_10m_max: [10, 12],
                relative_humidity_2m_mean: [80, 82],
            },
            hourly: {
                time: [
                    '2026-06-10T00:00', '2026-06-10T01:00', '2026-06-10T23:00',
                    '2026-06-11T06:00',
                ],
                temperature_2m: [11, 12, 14, 18],
                precipitation: [0, 0.1, 0, 0],
                wind_speed_10m: [6, 7, 9, 8],
            },
        });

        const rows = await fetchDailyWeather(52.2, -1.2);
        // Day 1 got its three hours bucketed by the LOCAL date prefix.
        expect(rows[0].utcOffsetSeconds).toBe(10800);
        expect(rows[0].hours).toEqual([
            { hour: 0, windKmh: 6, precipMm: 0, tempC: 11 },
            { hour: 1, windKmh: 7, precipMm: 0.1, tempC: 12 },
            { hour: 23, windKmh: 9, precipMm: 0, tempC: 14 },
        ]);
        // Day 2 got only its single 06:00 row.
        expect(rows[1].hours).toEqual([{ hour: 6, windKmh: 8, precipMm: 0, tempC: 18 }]);
    });

    it('passes the expected query params (lat/lon/daily vars/past+forecast days)', async () => {
        mockFetchOnce({ daily: { time: [] } });
        await fetchDailyWeather(52.2, -1.2);

        const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(url).toContain('https://api.open-meteo.com/v1/forecast');
        expect(url).toContain('latitude=52.2');
        expect(url).toContain('longitude=-1.2');
        expect(url).toContain('temperature_2m_max');
        expect(url).toContain('precipitation_sum');
        expect(url).toContain('past_days=7');
        expect(url).toContain('forecast_days=2');
        expect(url).toContain('timezone=auto');
        // Hourly series + km/h wind unit for the hourly spray-window.
        expect(url).toContain('hourly=');
        expect(url).toContain('temperature_2m');
        expect(url).toContain('precipitation');
        expect(url).toContain('wind_speed_10m');
        expect(url).toContain('wind_speed_unit=kmh');
    });

    it('null-fills utcOffsetSeconds + hours when the API omits them', async () => {
        mockFetchOnce({
            daily: { time: ['2026-06-10'], temperature_2m_max: [24] },
        });
        const rows = await fetchDailyWeather(0, 0);
        expect(rows[0].utcOffsetSeconds).toBeNull();
        expect(rows[0].hours).toEqual([]);
    });

    it('throws on a non-ok response', async () => {
        mockFetchOnce({ error: true, reason: 'bad' }, false, 429);
        await expect(fetchDailyWeather(0, 0)).rejects.toThrow(/Open-Meteo error 429/);
    });

    it('returns [] for a 200 with no daily series (grid edge)', async () => {
        mockFetchOnce({});
        const rows = await fetchDailyWeather(0, 0);
        expect(rows).toEqual([]);
    });

    it('null-fills missing/short arrays rather than throwing', async () => {
        mockFetchOnce({
            daily: {
                time: ['2026-06-10'],
                temperature_2m_max: [24],
                // temperature_2m_min omitted entirely
                precipitation_sum: [1],
            },
        });
        const rows = await fetchDailyWeather(0, 0);
        expect(rows[0].tempMinC).toBeNull();
        expect(rows[0].humidityMean).toBeNull();
        expect(rows[0].tempMaxC).toBe(24);
    });
});
