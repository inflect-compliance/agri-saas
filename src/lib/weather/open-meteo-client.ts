/**
 * Open-Meteo daily-forecast client — PURE HTTP, no DB.
 *
 * Open-Meteo (https://open-meteo.com) is a free, no-API-key weather
 * service released under CC-BY 4.0 / public-domain data terms. The
 * daily `weather-pull` job calls this once per farm location to pull a
 * short window of recent + near-future daily weather, which then feeds
 * the GDD accumulator and the spray-window / disease-risk evaluators
 * (`src/lib/agro/{gdd,rules}.ts`).
 *
 * Contract:
 *   • one GET to the forecast endpoint with the requested daily vars,
 *   • a 15s AbortController timeout (mirrors the OpenRouter provider),
 *   • a throw on any non-2xx,
 *   • the parallel `daily.*` arrays zipped into one row per calendar day.
 *
 * The module client is mocked in tests (`jest.mock`) — see the unit
 * test which stubs the global `fetch`.
 */

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** Default network budget — matches the OpenRouter provider's shape. */
const FETCH_TIMEOUT_MS = 15_000;

/** One LOCATION-LOCAL hour of weather, feeding the hourly spray-window. */
export interface HourWeather {
    /** Hour-of-day 0–23 in the LOCATION's local time (Open-Meteo `timezone=auto`). */
    hour: number;
    /** Wind speed at 10 m (km/h — the fetch forces `wind_speed_unit=kmh`). */
    windKmh: number | null;
    /** Precipitation for the hour (mm). */
    precipMm: number | null;
    /** Air temperature at 2 m (°C). */
    tempC: number | null;
}

/** One calendar day of weather as the agro layer consumes it. */
export interface DailyWeather {
    /** ISO calendar day (YYYY-MM-DD), as returned by Open-Meteo `daily.time`. */
    date: string;
    tempMaxC: number | null;
    tempMinC: number | null;
    /** Daily mean — Open-Meteo `temperature_2m_mean`; null if the API omits it. */
    tempMeanC: number | null;
    precipMm: number | null;
    windMaxKmh: number | null;
    /** Daily mean relative humidity (%). Optional — only some grids carry it. */
    humidityMean: number | null;
    /**
     * Location-local hourly rows for THIS calendar day (0–23), zipped from the
     * `hourly.*` arrays. Empty when the API omits an hourly series. Feeds
     * `computeSprayWindows` for the real "best window today" surface.
     */
    hours: HourWeather[];
    /**
     * Location UTC offset in seconds (`utc_offset_seconds`). Same for every day
     * of one response; carried per-day so the caller can persist it alongside
     * each WeatherObservation and later recover the location-local "now".
     */
    utcOffsetSeconds: number | null;
}

export interface FetchDailyWeatherOptions {
    /** Past days to include (Open-Meteo `past_days`, default 7). */
    days?: number;
    /** Forecast days to include (Open-Meteo `forecast_days`, default 2). */
    forecastDays?: number;
    /** IANA timezone or 'auto' (default 'auto' — the grid's local zone). */
    timezone?: string;
    /** Override the fetch timeout (ms). */
    timeoutMs?: number;
}

/** The slice of the Open-Meteo response we read. All arrays are index-aligned. */
interface OpenMeteoDailyResponse {
    /** Location UTC offset (seconds) — present when `timezone=auto`. */
    utc_offset_seconds?: number;
    daily?: {
        time?: string[];
        temperature_2m_max?: (number | null)[];
        temperature_2m_min?: (number | null)[];
        temperature_2m_mean?: (number | null)[];
        precipitation_sum?: (number | null)[];
        wind_speed_10m_max?: (number | null)[];
        relative_humidity_2m_mean?: (number | null)[];
    };
    /** Hourly series — `time` carries LOCAL `YYYY-MM-DDTHH:mm` stamps. */
    hourly?: {
        time?: string[];
        temperature_2m?: (number | null)[];
        precipitation?: (number | null)[];
        wind_speed_10m?: (number | null)[];
    };
}

/** Safe array index — returns null when the array is absent or short. */
function at(arr: (number | null)[] | undefined, i: number): number | null {
    if (!arr || i >= arr.length) return null;
    const v = arr[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Fetch a window of daily weather for one lat/lon. Pure HTTP; the
 * caller (the weather-pull job) maps these rows onto WeatherObservation
 * upserts and feeds them to the agro evaluators.
 */
export async function fetchDailyWeather(
    latitude: number,
    longitude: number,
    opts: FetchDailyWeatherOptions = {},
): Promise<DailyWeather[]> {
    const pastDays = opts.days ?? 7;
    const forecastDays = opts.forecastDays ?? 2;
    const timezone = opts.timezone ?? 'auto';

    const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'temperature_2m_mean',
            'precipitation_sum',
            'wind_speed_10m_max',
            'relative_humidity_2m_mean',
        ].join(','),
        // Hourly series for the real "best spray window today" — location-local
        // (timezone=auto). wind_speed_unit=kmh forces km/h so the hourly wind
        // matches the daily `wind_speed_10m_max` unit (Open-Meteo's default is
        // km/h; we pin it explicitly rather than rely on the default).
        hourly: [
            'temperature_2m',
            'precipitation',
            'wind_speed_10m',
        ].join(','),
        wind_speed_unit: 'kmh',
        past_days: String(pastDays),
        forecast_days: String(forecastDays),
        timezone,
    });
    const url = `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(`Open-Meteo error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as OpenMeteoDailyResponse;
    const time = data.daily?.time;
    if (!Array.isArray(time) || time.length === 0) {
        // A valid 200 with no daily series — treat as an empty window
        // rather than a throw, so a grid edge doesn't fail the job.
        return [];
    }

    const utcOffsetSeconds = typeof data.utc_offset_seconds === 'number' && Number.isFinite(data.utc_offset_seconds)
        ? data.utc_offset_seconds
        : null;
    const hoursByDate = groupHourlyByDate(data.hourly);

    const out: DailyWeather[] = [];
    for (let i = 0; i < time.length; i++) {
        out.push({
            date: time[i],
            tempMaxC: at(data.daily?.temperature_2m_max, i),
            tempMinC: at(data.daily?.temperature_2m_min, i),
            tempMeanC: at(data.daily?.temperature_2m_mean, i),
            precipMm: at(data.daily?.precipitation_sum, i),
            windMaxKmh: at(data.daily?.wind_speed_10m_max, i),
            humidityMean: at(data.daily?.relative_humidity_2m_mean, i),
            hours: hoursByDate.get(time[i]) ?? [],
            utcOffsetSeconds,
        });
    }
    return out;
}

/**
 * Zip the parallel `hourly.*` arrays into per-calendar-day `HourWeather[]`.
 * `hourly.time` carries LOCATION-LOCAL `YYYY-MM-DDTHH:mm` stamps (timezone=auto),
 * so the date prefix buckets the row and the `HH` prefix is the local hour.
 */
function groupHourlyByDate(hourly: OpenMeteoDailyResponse['hourly']): Map<string, HourWeather[]> {
    const byDate = new Map<string, HourWeather[]>();
    const times = hourly?.time;
    if (!Array.isArray(times)) return byDate;
    for (let i = 0; i < times.length; i++) {
        const stamp = times[i];
        if (typeof stamp !== 'string') continue;
        const tIdx = stamp.indexOf('T');
        if (tIdx < 0) continue;
        const date = stamp.slice(0, tIdx);
        const hour = Number(stamp.slice(tIdx + 1, tIdx + 3));
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const row: HourWeather = {
            hour,
            windKmh: at(hourly?.wind_speed_10m, i),
            precipMm: at(hourly?.precipitation, i),
            tempC: at(hourly?.temperature_2m, i),
        };
        const bucket = byDate.get(date);
        if (bucket) bucket.push(row);
        else byDate.set(date, [row]);
    }
    return byDate;
}
