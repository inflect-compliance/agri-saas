/**
 * Pure, DOM-free helpers for the Trends "Prices" tab.
 *
 * The `/trends/prices` payload arrives as a flat list of series, each grouped
 * by (source, region) and carrying its OWN `unit` + `currency` (EC = EUR/t,
 * BG oilseeds = BGN/т, Alpha Vantage = USD, listings = BGN). A EUR cereal
 * price and a BGN listings median must NEVER share a Y axis — so the tab
 * renders ONE chart per unit-group. These helpers do that grouping + the
 * TimeSeriesChart data assembly + the stat-tile derivations, kept pure so
 * they're unit-testable without jsdom/visx layout.
 *
 * @module components/trends/trends-helpers
 */
import type {
    TrendPricesResponse,
    TrendSeries,
    TrendPoint,
} from '@/app-layer/usecases/trends';

export type { TrendPricesResponse, TrendSeries, TrendPoint };

/** Canonical source slugs the backend writes (see market-prices-pull.ts). */
export const SOURCE_EC = 'ec-agrifood';
export const SOURCE_AV = 'alpha-vantage';
export const SOURCE_LISTINGS = 'listings';

/**
 * Map a backend `source` slug to its i18n key under `trends.sources`. Unknown
 * sources fall back to `other` so a future backend source renders SOMETHING
 * rather than a blank legend.
 */
export function sourceLabelKey(source: string): 'official' | 'reference' | 'listings' | 'other' {
    switch (source) {
        case SOURCE_EC:
            return 'official';
        case SOURCE_AV:
            return 'reference';
        case SOURCE_LISTINGS:
            return 'listings';
        default:
            return 'other';
    }
}

/** Stable per-series key within a group — source+region+stage is unique. */
export function seriesKey(s: Pick<TrendSeries, 'source' | 'region' | 'stage'>): string {
    return `${s.source}|${s.region}|${s.stage ?? ''}`;
}

export interface ChartGroup {
    /** `${region}|${currency}|${unit}` — the grouping key + a stable React key. */
    key: string;
    region: string;
    currency: string;
    unit: string;
    series: TrendSeries[];
}

/**
 * Partition the flat series list into chart-groups: ONE chart per
 * (region, currency, unit). Splitting by region — not just currency — keeps
 * each member state on its own chart even when two regions now share a
 * currency: Bulgaria adopted the euro in 2026, so BG and EL are both EUR/t yet
 * still render as separate charts. Within a group the series share a single Y
 * axis (a region's own stages at the same unit overlay cleanly); different
 * currencies never mix. Ordered by first appearance (the backend orders by
 * source asc then region asc, which keeps EC official prices first).
 */
export function groupSeriesByRegionUnit(series: TrendSeries[]): ChartGroup[] {
    const groups = new Map<string, ChartGroup>();
    for (const s of series) {
        if (s.points.length === 0) continue;
        const key = `${s.region}|${s.currency}|${s.unit}`;
        const existing = groups.get(key);
        if (existing) {
            existing.series.push(s);
        } else {
            groups.set(key, {
                key,
                region: s.region,
                currency: s.currency,
                unit: s.unit,
                series: [s],
            });
        }
    }
    return [...groups.values()];
}

export interface MergedDatum {
    date: Date;
    /** seriesKey → price for that date (sparse — a series may lack a date). */
    values: Record<string, number>;
}

/**
 * Merge every series in a group into one DENSE date-keyed row set for
 * `TimeSeriesChart`. Dates are the union across the group's series, ascending.
 * Every row carries EVERY series key: a date a series didn't report is
 * forward-filled from its last known price (and leading gaps back-filled from
 * its first), so overlaid lines never dip to zero on a one-week miss. Within a
 * unit-group the series usually share a cadence (all EC member states pull on
 * the same weekly dates), so fills are rare in practice.
 */
export function buildMergedData(group: ChartGroup): MergedDatum[] {
    const keys = group.series.map(seriesKey);
    const priceByKeyDate = new Map<string, Map<string, number>>();
    const dateSet = new Set<string>();
    for (const s of group.series) {
        const k = seriesKey(s);
        const m = new Map<string, number>();
        for (const p of s.points) {
            m.set(p.date, p.price);
            dateSet.add(p.date);
        }
        priceByKeyDate.set(k, m);
    }
    const dates = [...dateSet].sort();
    const last: Record<string, number | undefined> = {};
    const rows: MergedDatum[] = dates.map((d) => {
        const values: Record<string, number> = {};
        for (const k of keys) {
            const v = priceByKeyDate.get(k)?.get(d);
            if (v != null) last[k] = v;
            if (last[k] != null) values[k] = last[k]!;
        }
        return { date: new Date(`${d}T00:00:00Z`), values };
    });
    // Back-fill leading gaps: a series whose first report is late has no value
    // in early rows. Walk backwards filling each key's first-known price.
    const firstKnown: Record<string, number | undefined> = {};
    for (const k of keys) {
        for (const d of dates) {
            const v = priceByKeyDate.get(k)?.get(d);
            if (v != null) {
                firstKnown[k] = v;
                break;
            }
        }
    }
    for (const row of rows) {
        for (const k of keys) {
            if (row.values[k] == null && firstKnown[k] != null) row.values[k] = firstKnown[k]!;
        }
    }
    return rows;
}

/** The latest (most recent) point of a series, or null when empty. */
export function latestPoint(s: TrendSeries): TrendPoint | null {
    if (s.points.length === 0) return null;
    return s.points[s.points.length - 1];
}

/**
 * Week-over-week delta: latest price minus the price ~7 days earlier (the
 * closest earlier point at least 5 days back; falls back to the immediately
 * prior point). Returns null when there aren't two comparable points.
 */
export function weekOverWeekDelta(s: TrendSeries): number | null {
    const pts = s.points;
    if (pts.length < 2) return null;
    const latest = pts[pts.length - 1];
    const latestMs = new Date(`${latest.date}T00:00:00Z`).getTime();
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    for (let i = pts.length - 2; i >= 0; i -= 1) {
        const ms = new Date(`${pts[i].date}T00:00:00Z`).getTime();
        if (latestMs - ms >= fiveDaysMs) return latest.price - pts[i].price;
    }
    return latest.price - pts[pts.length - 2].price;
}

/** First EC (official) series for `region` (default BG), or null. */
export function findEcSeries(series: TrendSeries[], region = 'BG'): TrendSeries | null {
    return series.find((s) => s.source === SOURCE_EC && s.region === region) ?? null;
}

/** The own-listings-index series (region BG), or null. */
export function findListingsSeries(series: TrendSeries[]): TrendSeries | null {
    return series.find((s) => s.source === SOURCE_LISTINGS) ?? null;
}

/** The Alpha Vantage reference series, or null. */
export function findReferenceSeries(series: TrendSeries[]): TrendSeries | null {
    return series.find((s) => s.source === SOURCE_AV) ?? null;
}

/**
 * True when the payload carries no plottable data at all. Drives the empty /
 * operator-unconfigured state (the endpoint degrades to empty series when the
 * EC / Alpha Vantage sources are unconfigured OR the window has no data).
 */
export function isEmptyPayload(payload: TrendPricesResponse | undefined): boolean {
    if (!payload) return false;
    return payload.series.every((s) => s.points.length === 0);
}

/** Round-trip-safe display number: fixed to at most 2 decimals, trimmed. */
export function formatPrice(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Display price with its ISO currency suffix (e.g. `"512 EUR"`). */
export function formatPriceWithCurrency(value: number, currency: string): string {
    return currency ? `${formatPrice(value)} ${currency}` : formatPrice(value);
}

/** Signed, 2-decimal delta for the WoW tile (`+12.5` / `-3.2`). */
export function formatDelta(value: number): string {
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toFixed(2)}`;
}
