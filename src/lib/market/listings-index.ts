/**
 * Own-listings weekly price index — PURE, no DB.
 *
 * Computes a WEEKLY MEDIAN price per (commodity, currency) across ALL
 * tenants' ACTIVE ExchangeListings. This is cross-tenant by design (a market
 * signal only makes sense pooled), so PRIVACY is enforced by a k-anonymity
 * floor: a (commodity, currency) group is emitted ONLY when it draws on at
 * least `LISTINGS_K_ANON_FLOOR` DISTINCT tenants. Below the floor the group is
 * suppressed entirely. The emitted point carries only `{ median, count }` —
 * never a listing id or tenant id.
 *
 * Kept prisma-free so the k-anonymity invariant is unit-testable in memory.
 *
 * @module lib/market/listings-index
 */

/** Minimum DISTINCT tenants required to publish a (commodity, currency) group. */
export const LISTINGS_K_ANON_FLOOR = 3;

/** One ACTIVE listing's price-relevant fields (all listings are per-tonne). */
export interface ListingPriceRow {
    commodity: string;
    /** Price per tonne (listings with a null price are pre-filtered out). */
    pricePerTonne: number;
    /** Listing currency (BGN default). */
    priceCurrency: string;
    /** Owning tenant — used ONLY to count distinct tenants, never stored. */
    sellerTenantId: string;
}

/** A k-anon-cleared weekly median for one (commodity, currency). */
export interface ListingMedianGroup {
    commodity: string;
    currency: string;
    /** Chart unit — all exchange prices are per tonne. */
    unit: string;
    /** Median price per tonne, rounded to 2 dp. */
    median: number;
    /** Number of DISTINCT contributing tenants (≥ floor). */
    count: number;
}

/** Median of a non-empty numeric list (mean of the two middles when even). */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const m = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return Math.round(m * 100) / 100;
}

/**
 * Compute the k-anonymised weekly median index. Groups by (commodity,
 * currency); suppresses any group backed by fewer than
 * `LISTINGS_K_ANON_FLOOR` distinct tenants; returns the survivors sorted
 * deterministically.
 */
export function computeListingsMedianIndex(rows: ListingPriceRow[]): ListingMedianGroup[] {
    const groups = new Map<
        string,
        { commodity: string; currency: string; prices: number[]; tenants: Set<string> }
    >();

    for (const r of rows) {
        if (!Number.isFinite(r.pricePerTonne)) continue;
        const currency = r.priceCurrency || 'BGN';
        const key = `${r.commodity}||${currency}`;
        let g = groups.get(key);
        if (!g) {
            g = { commodity: r.commodity, currency, prices: [], tenants: new Set() };
            groups.set(key, g);
        }
        g.prices.push(r.pricePerTonne);
        g.tenants.add(r.sellerTenantId);
    }

    const out: ListingMedianGroup[] = [];
    for (const g of groups.values()) {
        // k-anonymity: suppress groups drawing on too few distinct tenants.
        if (g.tenants.size < LISTINGS_K_ANON_FLOOR) continue;
        out.push({
            commodity: g.commodity,
            currency: g.currency,
            unit: `${g.currency}/t`,
            median: median(g.prices),
            count: g.tenants.size,
        });
    }

    out.sort((a, b) => a.commodity.localeCompare(b.commodity) || a.currency.localeCompare(b.currency));
    return out;
}
