/**
 * Alpha Vantage commodities client — PURE HTTP, no DB.
 *
 * Fetches the global reference price series for WHEAT + CORN from Alpha
 * Vantage (https://www.alphavantage.co/query). Contract mirrors the SoilGrids
 * client: one GET per call, an AbortController timeout, a throw on any
 * non-2xx, a base-URL override for tests, and an injectable `fetch`.
 *
 * NOT LIVE-VERIFIED — there is no free API key in this environment, so this is
 * built to the DOCUMENTED response shape `{ data: [{ date, value }] }` (USD,
 * region GLOBAL). It is isolated fully behind this module so a paid futures
 * feed can replace it later without touching the job.
 *
 * The FREE tier allows 25 requests/day, so callers batch commodities and
 * back off on a rate-limit signal. Alpha Vantage signals a throttle with an
 * HTTP 429 OR a JSON body carrying a `Note` / `Information` field (no `data`);
 * `AlphaVantageRateLimitError` normalises both so the job can back off.
 *
 * @module lib/market/alpha-vantage-client
 */

/** Default Alpha Vantage query base (overridable for tests). */
export const ALPHA_VANTAGE_DEFAULT_BASE_URL = 'https://www.alphavantage.co';

const FETCH_TIMEOUT_MS = 30_000;

/** Alpha Vantage commodity function → our commodity slug. */
export const ALPHA_VANTAGE_FUNCTIONS: Record<string, string> = {
    WHEAT: 'wheat',
    CORN: 'maize',
};

/** Thrown when Alpha Vantage rate-limits (HTTP 429 or a Note/Information body). */
export class AlphaVantageRateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AlphaVantageRateLimitError';
    }
}

type FetchFn = typeof fetch;

export interface AlphaVantageFetchOptions {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: FetchFn;
    /** Data interval (default 'monthly' — the free commodity granularity). */
    interval?: 'monthly' | 'quarterly' | 'annual';
}

/** One normalised Alpha Vantage observation. */
export interface AlphaVantageObservation {
    /** ISO date "yyyy-mm-dd". */
    date: string;
    /** Parsed value, or null when the source value is non-numeric ("."). */
    value: number | null;
}

export interface AlphaVantageSeries {
    /** Reported unit, e.g. "USD per metric ton" (defaults to 'USD/t'). */
    unit: string;
    /** Always USD for the commodities endpoint. */
    currency: string;
    observations: AlphaVantageObservation[];
}

interface RawAlphaVantageResponse {
    unit?: string;
    data?: Array<{ date?: string; value?: string }>;
    Note?: string;
    Information?: string;
    'Error Message'?: string;
}

/**
 * Fetch one commodity series ('WHEAT' | 'CORN'). Throws
 * `AlphaVantageRateLimitError` on a throttle so the caller can back off, or a
 * plain Error on any other non-2xx / malformed body.
 */
export async function fetchAlphaVantageCommodity(
    func: 'WHEAT' | 'CORN',
    apiKey: string,
    opts: AlphaVantageFetchOptions = {},
): Promise<AlphaVantageSeries> {
    const base = (opts.baseUrl ?? ALPHA_VANTAGE_DEFAULT_BASE_URL).replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('function', func);
    params.set('interval', opts.interval ?? 'monthly');
    params.set('apikey', apiKey);
    const url = `${base}/query?${params.toString()}`;

    const doFetch = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
    let response: Response;
    try {
        response = await doFetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (response.status === 429) {
        throw new AlphaVantageRateLimitError('Alpha Vantage rate limit (HTTP 429)');
    }
    if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(`Alpha Vantage error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as RawAlphaVantageResponse;

    // Throttle / soft-error signalled in the JSON body (HTTP 200).
    if (data.Note || data.Information) {
        throw new AlphaVantageRateLimitError(
            (data.Note ?? data.Information ?? 'Alpha Vantage throttled').slice(0, 200),
        );
    }
    if (data['Error Message']) {
        throw new Error(`Alpha Vantage error: ${data['Error Message'].slice(0, 200)}`);
    }

    const rows = Array.isArray(data.data) ? data.data : [];
    const observations: AlphaVantageObservation[] = rows.map((r) => {
        const parsed = Number.parseFloat(r.value ?? '');
        return {
            date: r.date ?? '',
            value: Number.isFinite(parsed) ? parsed : null,
        };
    });

    return {
        unit: data.unit && data.unit.trim().length ? data.unit.trim() : 'USD/t',
        currency: 'USD',
        observations,
    };
}
