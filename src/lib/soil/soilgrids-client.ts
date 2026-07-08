/**
 * ISRIC SoilGrids 2.0 client — PURE HTTP, no DB.
 *
 * SoilGrids (https://soilgrids.org) is ISRIC's global, open (CC-BY 4.0,
 * commercial-OK) digital soil map. It is a MODEL, not a field survey — the
 * returned values are predictions with quantified uncertainty, so callers
 * MUST surface them as estimates (see `SoilProfile`). This is the only open,
 * commercial-safe, per-point soil source covering Bulgaria.
 *
 * Contract (mirrors the Open-Meteo client):
 *   • one GET to the properties/query endpoint for the requested layers,
 *   • a 15s AbortController timeout,
 *   • a throw on any non-2xx (the beta REST API is rate-limited ~5 req/min;
 *     the caller runs this behind a cache + a queue rate limiter),
 *   • the nested `properties.layers[].depths[].values.{mean,uncertainty}`
 *     structure flattened into one `SoilProfile`, converting SoilGrids
 *     mapped units to real-world units via the per-property d-factors.
 *
 * The module is mocked in tests (`jest.mock`) — the unit tests stub the
 * global `fetch` and assert the unit conversions + texture derivation.
 *
 * @module lib/soil/soilgrids-client
 */
import { classifyUsdaTexture } from './texture';
import type { SoilProfile, SoilPropertyStat } from './types';

/** Default SoilGrids REST base (overridable via SOIL_BASE_URL). */
export const SOILGRIDS_DEFAULT_BASE_URL = 'https://rest.isric.org/soilgrids/v2.0';

const FETCH_TIMEOUT_MS = 15_000;

/** Depth interval we read (topsoil — most relevant to crop planning). */
const DEPTH = '0-5cm';

/**
 * SoilGrids properties and the divisor that converts the API's integer
 * "mapped units" back to real-world units (the published d-factors):
 *   clay/sand/silt g/kg → % (÷10); phh2o pH×10 → pH (÷10);
 *   soc dg/kg → g/kg (÷10); bdod cg/cm³ → g/cm³ (÷100).
 */
const PROPERTY_DIVISOR = {
    clay: 10,
    sand: 10,
    silt: 10,
    phh2o: 10,
    soc: 10,
    bdod: 100,
} as const;

type SoilProperty = keyof typeof PROPERTY_DIVISOR;

export interface FetchSoilOptions {
    /** Base URL override (SOIL_BASE_URL). */
    baseUrl?: string;
    /** Fetch timeout (ms). */
    timeoutMs?: number;
    /** Provider label stamped onto the profile (default "soilgrids"). */
    provider?: string;
}

/** The slice of the SoilGrids response we read. */
interface SoilGridsResponse {
    properties?: {
        layers?: Array<{
            name?: string;
            depths?: Array<{
                label?: string;
                values?: { mean?: number | null; uncertainty?: number | null };
            }>;
        }>;
    };
}

/** Extract mean+uncertainty for one property at our depth, unit-converted. */
function readLayer(resp: SoilGridsResponse, property: SoilProperty): SoilPropertyStat {
    const layer = resp.properties?.layers?.find((l) => l.name === property);
    const depth = layer?.depths?.find((d) => d.label === DEPTH) ?? layer?.depths?.[0];
    const divisor = PROPERTY_DIVISOR[property];
    const raw = depth?.values;
    const conv = (v: number | null | undefined): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v / divisor : null;
    return { mean: conv(raw?.mean), uncertainty: conv(raw?.uncertainty) };
}

/**
 * Fetch and normalise the topsoil profile for one lat/lon into a
 * `SoilProfile`. Throws on a non-2xx (so the job's retry/backoff + the
 * cache absorb the beta API's rate limits). A 200 with missing layers
 * yields a profile of nulls (honest "unknown"), never a fabricated value.
 */
export async function fetchSoilProfile(
    latitude: number,
    longitude: number,
    opts: FetchSoilOptions = {},
): Promise<SoilProfile> {
    const base = (opts.baseUrl ?? SOILGRIDS_DEFAULT_BASE_URL).replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('lon', String(longitude));
    params.set('lat', String(latitude));
    for (const p of ['clay', 'sand', 'silt', 'phh2o', 'soc', 'bdod']) params.append('property', p);
    params.set('depth', DEPTH);
    params.append('value', 'mean');
    params.append('value', 'uncertainty');
    const url = `${base}/properties/query?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(`SoilGrids error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as SoilGridsResponse;
    return normaliseSoilGrids(data, {
        provider: opts.provider ?? 'soilgrids',
        fetchedAt: new Date().toISOString(),
    });
}

/**
 * Pure transform of a SoilGrids response into a `SoilProfile`. Exposed
 * separately so unit tests can feed a canned response with no network and
 * assert the unit conversions + USDA texture derivation.
 */
export function normaliseSoilGrids(
    data: SoilGridsResponse,
    meta: { provider: string; fetchedAt: string },
): SoilProfile {
    const clay = readLayer(data, 'clay');
    const sand = readLayer(data, 'sand');
    const silt = readLayer(data, 'silt');
    const phh2o = readLayer(data, 'phh2o');
    const soc = readLayer(data, 'soc');
    const bdod = readLayer(data, 'bdod');

    return {
        textureClass: classifyUsdaTexture(sand.mean, silt.mean, clay.mean),
        sandPct: sand.mean,
        siltPct: silt.mean,
        clayPct: clay.mean,
        phH2o: phh2o.mean,
        socGkg: soc.mean,
        bulkDensity: bdod.mean,
        depth: DEPTH,
        uncertainty: { sand, silt, clay, phh2o, soc, bdod },
        provider: meta.provider,
        fetchedAt: meta.fetchedAt,
    };
}
