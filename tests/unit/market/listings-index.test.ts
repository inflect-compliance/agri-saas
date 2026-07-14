import {
    computeListingsMedianIndex,
    LISTINGS_K_ANON_FLOOR,
    type ListingPriceRow,
} from '@/lib/market/listings-index';

const row = (tenant: string, price: number, commodity = 'wheat', currency = 'BGN'): ListingPriceRow => ({
    commodity,
    pricePerTonne: price,
    priceCurrency: currency,
    sellerTenantId: tenant,
});

describe('computeListingsMedianIndex (k-anonymity)', () => {
    it('has a k-anonymity floor of 3 distinct tenants', () => {
        expect(LISTINGS_K_ANON_FLOOR).toBe(3);
    });

    it('SUPPRESSES a group backed by only 2 distinct tenants', () => {
        const out = computeListingsMedianIndex([
            row('t1', 100),
            row('t2', 200),
            row('t2', 300), // same tenant → still only 2 distinct
        ]);
        expect(out).toHaveLength(0);
    });

    it('EMITS a group backed by 3 distinct tenants with median + count', () => {
        const out = computeListingsMedianIndex([
            row('t1', 100),
            row('t2', 200),
            row('t3', 300),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({
            commodity: 'wheat',
            currency: 'BGN',
            unit: 'BGN/t',
            median: 200, // middle of [100,200,300]
            count: 3, // distinct tenants
        });
    });

    it('averages the two middle values for an even count', () => {
        const out = computeListingsMedianIndex([
            row('t1', 100),
            row('t2', 200),
            row('t3', 300),
            row('t4', 500),
        ]);
        expect(out[0].median).toBe(250); // (200+300)/2
        expect(out[0].count).toBe(4);
    });

    it('groups independently by (commodity, currency)', () => {
        const out = computeListingsMedianIndex([
            // wheat/BGN — 3 tenants → emitted
            row('t1', 100),
            row('t2', 200),
            row('t3', 300),
            // maize/BGN — only 2 tenants → suppressed
            row('t1', 400, 'maize'),
            row('t2', 500, 'maize'),
            // wheat/EUR — 3 tenants → emitted (separate currency group)
            row('t1', 90, 'wheat', 'EUR'),
            row('t2', 110, 'wheat', 'EUR'),
            row('t3', 130, 'wheat', 'EUR'),
        ]);
        const keys = out.map((g) => `${g.commodity}/${g.currency}`);
        expect(keys).toEqual(['wheat/BGN', 'wheat/EUR']);
        expect(out.find((g) => g.currency === 'EUR')?.median).toBe(110);
    });

    it('never leaks tenant ids — output carries only median + count', () => {
        const out = computeListingsMedianIndex([row('t1', 100), row('t2', 200), row('t3', 300)]);
        expect(Object.keys(out[0]).sort()).toEqual(['commodity', 'count', 'currency', 'median', 'unit']);
    });
});
