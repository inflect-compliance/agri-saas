/**
 * Unit tests — Exchange usecase cross-tenant guards + global reads.
 *
 * The Exchange tables are GLOBAL (no RLS), so the usecase layer is the sole
 * cross-tenant safety boundary. These tests lock the invariants:
 *   - editing (withdraw/fulfil) ANOTHER tenant's listing throws forbidden;
 *   - inquiring on your OWN listing throws forbidden;
 *   - listActiveListings returns rows across tenants (the read is global,
 *     NOT tenant-filtered).
 *
 * Prisma + repository + audit are mocked (no DB); `runInTenantContext` is a
 * passthrough that hands a stub `db` to the usecase callback.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = {} as any;

jest.mock('@/lib/db-context', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/repositories/exchange', () => ({
    ExchangeRepository: {
        listActiveListings: jest.fn(),
        getListing: jest.fn(),
        createListing: jest.fn(),
        updateListingStatus: jest.fn(),
        createInquiry: jest.fn(),
        listInquiriesForSeller: jest.fn(),
        listInquiriesByInquirer: jest.fn(),
    },
}));

jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn() }));

// Keep sanitize a passthrough — the sanitiser has its own tests; here we
// only care that free text flows through it (identity is enough).
jest.mock('@/lib/security/sanitize', () => ({
    sanitizePlainText: (s: string | null | undefined) => (s == null ? '' : s),
}));

import { ExchangeRepository } from '@/app-layer/repositories/exchange';
import {
    listActiveListings,
    createListing,
    withdrawListing,
    fulfillListing,
    createInquiry,
} from '@/app-layer/usecases/exchange';
import { makeRequestContext } from '../helpers/make-context';

const repo = ExchangeRepository as jest.Mocked<typeof ExchangeRepository>;

// Two different tenants.
const meCtx = makeRequestContext('EDITOR', { tenantId: 'tenant-1', userId: 'user-1' });
const otherTenantId = 'tenant-2';

function listing(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'lst-1',
        sellerTenantId: 'tenant-1',
        sellerUserId: 'user-1',
        side: 'SELL',
        commodity: 'Wheat',
        status: 'ACTIVE',
        regionCode: 'BG-16',
        ...overrides,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

beforeEach(() => jest.clearAllMocks());

describe('cross-tenant write guard', () => {
    it('withdrawListing on ANOTHER tenant’s listing throws forbidden', async () => {
        repo.getListing.mockResolvedValue(listing({ sellerTenantId: otherTenantId }));
        await expect(withdrawListing(meCtx, 'lst-1')).rejects.toThrow(/your own listings/i);
        expect(repo.updateListingStatus).not.toHaveBeenCalled();
    });

    it('fulfillListing on ANOTHER tenant’s listing throws forbidden', async () => {
        repo.getListing.mockResolvedValue(listing({ sellerTenantId: otherTenantId }));
        await expect(fulfillListing(meCtx, 'lst-1')).rejects.toThrow(/your own listings/i);
        expect(repo.updateListingStatus).not.toHaveBeenCalled();
    });

    it('withdrawListing on your OWN listing succeeds + flips status to WITHDRAWN', async () => {
        repo.getListing.mockResolvedValue(listing({ sellerTenantId: 'tenant-1' }));
        repo.updateListingStatus.mockResolvedValue(listing({ status: 'WITHDRAWN' }));
        await withdrawListing(meCtx, 'lst-1');
        expect(repo.updateListingStatus).toHaveBeenCalledWith(mockDb, 'lst-1', 'WITHDRAWN');
    });

    it('withdrawListing on a missing listing throws notFound', async () => {
        repo.getListing.mockResolvedValue(null);
        await expect(withdrawListing(meCtx, 'nope')).rejects.toThrow(/not found/i);
    });
});

describe('createInquiry guards', () => {
    it('inquiring on your OWN listing throws forbidden', async () => {
        repo.getListing.mockResolvedValue(listing({ sellerTenantId: 'tenant-1', status: 'ACTIVE' }));
        await expect(
            createInquiry(meCtx, { listingId: 'lst-1', message: 'interested' }),
        ).rejects.toThrow(/your own listing/i);
        expect(repo.createInquiry).not.toHaveBeenCalled();
    });

    it('inquiring on a non-ACTIVE listing throws badRequest', async () => {
        repo.getListing.mockResolvedValue(listing({ sellerTenantId: otherTenantId, status: 'FULFILLED' }));
        await expect(
            createInquiry(meCtx, { listingId: 'lst-1', message: 'interested' }),
        ).rejects.toThrow(/listing_not_active/i);
        expect(repo.createInquiry).not.toHaveBeenCalled();
    });

    it('inquiring on ANOTHER tenant’s ACTIVE listing succeeds', async () => {
        repo.getListing.mockResolvedValue(listing({ sellerTenantId: otherTenantId, status: 'ACTIVE' }));
        repo.createInquiry.mockResolvedValue({ id: 'inq-1' } as never);
        await createInquiry(meCtx, { listingId: 'lst-1', message: 'interested' });
        expect(repo.createInquiry).toHaveBeenCalledWith(
            mockDb,
            expect.objectContaining({
                listingId: 'lst-1',
                inquirerTenantId: 'tenant-1',
                inquirerUserId: 'user-1',
            }),
        );
    });
});

describe('createListing', () => {
    it('rejects an unknown region code with badRequest', async () => {
        await expect(
            createListing(meCtx, {
                side: 'SELL',
                commodity: 'Wheat',
                quantityTonnes: 10,
                regionCode: 'BG-99',
            }),
        ).rejects.toThrow(/region/i);
        expect(repo.createListing).not.toHaveBeenCalled();
    });

    it('fixes ownership to the caller tenant + derives region from the code', async () => {
        repo.createListing.mockResolvedValue(listing() as never);
        await createListing(meCtx, {
            side: 'SELL',
            commodity: 'Wheat',
            quantityTonnes: 10,
            regionCode: 'BG-16',
        });
        expect(repo.createListing).toHaveBeenCalledWith(
            mockDb,
            expect.objectContaining({
                sellerTenantId: 'tenant-1',
                sellerUserId: 'user-1',
                regionCode: 'BG-16',
                regionName: 'Plovdiv',
                priceCurrency: 'BGN',
            }),
        );
    });
});

describe('listActiveListings is a GLOBAL read', () => {
    it('returns rows from OTHER tenants (not filtered by ctx.tenantId)', async () => {
        const crossTenantRows = [
            listing({ id: 'a', sellerTenantId: 'tenant-1' }),
            listing({ id: 'b', sellerTenantId: 'tenant-2' }),
            listing({ id: 'c', sellerTenantId: 'tenant-3' }),
        ];
        repo.listActiveListings.mockResolvedValue(crossTenantRows as never);

        const result = await listActiveListings(meCtx, {});

        // The usecase passes the caller's filters straight through and never
        // injects a tenantId — so a tenant-1 caller sees tenant-2/3 rows.
        expect(result).toHaveLength(3);
        const sellers = new Set(result.map((r) => r.sellerTenantId));
        expect(sellers).toEqual(new Set(['tenant-1', 'tenant-2', 'tenant-3']));
        // Repository was called with the db + filters only — no tenant arg.
        expect(repo.listActiveListings).toHaveBeenCalledWith(mockDb, {});
    });
});
