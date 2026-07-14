/**
 * EC AGRI-food data-portal client — PURE HTTP, no DB.
 *
 * Fetches weekly cereal + oilseed prices from the European Commission's open
 * AGRI-food API (https://www.ec.europa.eu/agrifood/api). Contract mirrors the
 * SoilGrids client: one GET per call, an AbortController timeout, a throw on
 * any non-2xx, a base-URL override for tests, and an injectable `fetch`.
 *
 * TWO endpoints, TWO record shapes (verified by smoke-testing from prod — the
 * sandbox cannot reach the host):
 *
 *   • Cereals  — GET /cereal/prices?memberStateCodes=..&productCodes=..&years=..
 *       keys: memberStateCode, beginDate("dd/mm/yyyy"), price("€178,00" — EUR,
 *       COMMA decimal), unit("TONNES"), productName, marketName, stageName.
 *       Always EUR; stored unit "EUR/t".
 *
 *   • Oilseeds — GET /oilseeds/prices?memberStateCodes=..&years=..
 *       (NOTE the singular /oilseed/ 404s.) DIFFERENT keys: product (not
 *       productName), market (not marketName), marketStage (not stageName),
 *       price("€512.00" — DOT decimal), unit("national currency/ton"). The `€`
 *       glyph is misleading — the real currency is the member state's national
 *       currency (BG→BGN, RO→RON, EL/EU→EUR). Stored unit "<CUR>/t".
 *
 * Responses are HUGE (~4.7MB per member-state-year), so callers MUST always
 * filter by productCodes + memberStateCodes.
 *
 * @module lib/market/ec-agrifood-client
 */
import { parseEuroPrice, oilseedCurrencyForRegion } from './price-parse';

/** Default EC AGRI-food API base (overridable via EC_AGRIFOOD_BASE_URL). */
export const EC_AGRIFOOD_DEFAULT_BASE_URL = 'https://www.ec.europa.eu/agrifood/api';

const FETCH_TIMEOUT_MS = 30_000;

/** Our commodity slug → EC cereal product code (see /cereal/products). */
export const CEREAL_PRODUCT_CODES: Record<string, string> = {
    wheat: 'BLTPAN', // common breadmaking wheat
    maize: 'MAI', // feed maize
    barley: 'ORGFOUR', // feed barley
};

/** Injectable fetch (defaults to global fetch). */
type FetchFn = typeof fetch;

export interface EcFetchOptions {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: FetchFn;
}

/**
 * One normalised EC price observation. `price` is already parsed to a number
 * (null → skip row); `currency` + `unit` are resolved per-endpoint and are
 * NOT normalised across sources (a BGN oilseed price stays BGN).
 */
export interface EcObservation {
    /** Member-state code — doubles as our `region` ('BG' | 'RO' | 'EL' | 'EU'). */
    memberStateCode: string;
    /** Human product name (→ series label). */
    productName: string;
    /** Market stage (EC stageName / marketStage); null/empty → null. */
    stage: string | null;
    /** Specific market name (EC marketName / market), for provenance. */
    market: string | null;
    /** Period start "dd/mm/yyyy". */
    beginDate: string;
    /** Parsed price, or null when the source value is non-numeric. */
    price: number | null;
    /** Stored unit, e.g. "EUR/t" | "BGN/t". */
    unit: string;
    /** ISO currency of `price`. */
    currency: string;
}

/** Loose shape of a raw cereal record (only the keys we read). */
interface RawCerealRecord {
    memberStateCode?: string;
    beginDate?: string;
    price?: string;
    productName?: string;
    marketName?: string;
    stageName?: string;
}

/** Loose shape of a raw oilseed record — note the DIFFERENT keys. */
interface RawOilseedRecord {
    memberStateCode?: string;
    beginDate?: string;
    price?: string;
    product?: string;
    market?: string;
    marketStage?: string;
}

async function getJson(url: string, opts: EcFetchOptions): Promise<unknown> {
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
    if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(`EC AGRI-food error ${response.status}: ${errorText.slice(0, 200)}`);
    }
    return response.json();
}

function trimOrNull(v: string | undefined): string | null {
    const t = (v ?? '').trim();
    return t.length ? t : null;
}

/**
 * Fetch weekly CEREAL prices. Callers pass a SINGLE product code per call so
 * every returned record maps unambiguously to one commodity slug (the
 * response carries no product code, only productName). Always EUR.
 */
export async function fetchCerealPrices(
    args: { memberStateCodes: string[]; productCodes: string[]; years: number[] },
    opts: EcFetchOptions = {},
): Promise<EcObservation[]> {
    const base = (opts.baseUrl ?? EC_AGRIFOOD_DEFAULT_BASE_URL).replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('memberStateCodes', args.memberStateCodes.join(','));
    params.set('productCodes', args.productCodes.join(','));
    params.set('years', args.years.join(','));
    const url = `${base}/cereal/prices?${params.toString()}`;
    const data = await getJson(url, opts);
    const rows: RawCerealRecord[] = Array.isArray(data) ? data : [];
    return rows.map((r) => ({
        memberStateCode: (r.memberStateCode ?? '').toUpperCase(),
        productName: r.productName ?? '',
        stage: trimOrNull(r.stageName),
        market: trimOrNull(r.marketName),
        beginDate: r.beginDate ?? '',
        price: parseEuroPrice(r.price),
        unit: 'EUR/t',
        currency: 'EUR',
    }));
}

/**
 * Fetch weekly OILSEED prices (sunflower lives here). Records use the
 * DIFFERENT key names (product / market / marketStage) and a DOT decimal; the
 * currency is resolved from the member state, never the misleading `€` glyph.
 */
export async function fetchOilseedPrices(
    args: { memberStateCodes: string[]; years: number[] },
    opts: EcFetchOptions = {},
): Promise<EcObservation[]> {
    const base = (opts.baseUrl ?? EC_AGRIFOOD_DEFAULT_BASE_URL).replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('memberStateCodes', args.memberStateCodes.join(','));
    params.set('years', args.years.join(','));
    const url = `${base}/oilseeds/prices?${params.toString()}`;
    const data = await getJson(url, opts);
    const rows: RawOilseedRecord[] = Array.isArray(data) ? data : [];
    return rows.map((r) => {
        const region = (r.memberStateCode ?? '').toUpperCase();
        const currency = oilseedCurrencyForRegion(region);
        return {
            memberStateCode: region,
            productName: r.product ?? '',
            stage: trimOrNull(r.marketStage),
            market: trimOrNull(r.market),
            beginDate: r.beginDate ?? '',
            price: parseEuroPrice(r.price),
            unit: `${currency}/t`,
            currency,
        };
    });
}
