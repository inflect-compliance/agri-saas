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
// The seller-tenant db handle handed to withTenantDb — captures notification writes.
const notificationCreateMany = jest.fn();
const mockSellerDb = { notification: { createMany: notificationCreateMany } };
// Captures the tenantId withTenantDb was bound to (must be the SELLER's).
const withTenantDbCalls: string[] = [];

jest.mock('@/lib/db-context', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantDb: jest.fn(async (tenantId: string, fn: (db: any) => any) => {
        withTenantDbCalls.push(tenantId);
        return fn(mockSellerDb);
    }),
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
        getInquiry: jest.fn(),
        updateInquiryStatus: jest.fn(),
        listListingsBySeller: jest.fn(),
    },
}));

jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn() }));

// Keep sanitize a passthrough — the sanitiser has its own tests; here we
// only care that free text flows through it (identity is enough).
jest.mock('@/lib/security/sanitize', () => ({
    sanitizePlainText: (s: string | null | undefined) => (s == null ? '' : s),
}));

const membershipFindMany = jest.fn();
jest.mock('@/lib/prisma', () => ({
    prisma: { tenantMembership: { findMany: (...a: unknown[]) => membershipFindMany(...a) } },
}));

const sendInquiryEmail = jest.fn();
jest.mock('@/lib/email/inquiry-email', () => ({
    sendInquiryEmail: (...a: unknown[]) => sendInquiryEmail(...a),
}));

jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { ExchangeRepository } from '@/app-layer/repositories/exchange';
import {
    listActiveListings,
    createListing,
    withdrawListing,
    fulfillListing,
    createInquiry,
    respondToInquiry,
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

beforeEach(() => {
    jest.clearAllMocks();
    withTenantDbCalls.length = 0;
    membershipFindMany.mockResolvedValue([]);
    sendInquiryEmail.mockResolvedValue({ sent: true });
    notificationCreateMany.mockResolvedValue({ count: 0 });
});

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

describe('createInquiry seller fanout (notify + email, fail-open)', () => {
    const activeListing = { sellerTenantId: 'tenant-2', status: 'ACTIVE', commodity: 'Wheat', side: 'SELL' };

    it('writes the Notification in the SELLER tenant (withTenantDb) + emails its admins', async () => {
        repo.getListing.mockResolvedValue(listing({ ...activeListing }));
        repo.createInquiry.mockResolvedValue({ id: 'inq-1', quantityTonnes: null } as never);
        membershipFindMany.mockResolvedValue([
            { userId: 'seller-admin-1', user: { email: 'a1@seller.test' }, tenant: { slug: 'seller' } },
            { userId: 'seller-admin-2', user: { email: 'a2@seller.test' }, tenant: { slug: 'seller' } },
        ]);

        await createInquiry(meCtx, { listingId: 'lst-1', message: 'want 100t' });

        // Notification is bound to the SELLER's tenant (tenant-2), NOT the
        // inquirer's (tenant-1) — RLS would reject it otherwise.
        expect(withTenantDbCalls).toEqual(['tenant-2']);
        expect(notificationCreateMany).toHaveBeenCalledTimes(1);
        const notifArg = notificationCreateMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
        expect(notifArg.data).toHaveLength(2);
        expect(notifArg.data[0]).toMatchObject({ tenantId: 'tenant-2', userId: 'seller-admin-1' });
        // Both seller admins emailed.
        expect(sendInquiryEmail).toHaveBeenCalledTimes(2);
        expect(sendInquiryEmail).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'a1@seller.test', commodity: 'Wheat' }),
        );
    });

    it('is fail-open — an email failure does NOT reject the committed inquiry', async () => {
        repo.getListing.mockResolvedValue(listing({ ...activeListing }));
        repo.createInquiry.mockResolvedValue({ id: 'inq-1', quantityTonnes: null } as never);
        membershipFindMany.mockResolvedValue([{ userId: 's1', user: { email: 'a@s.test' }, tenant: { slug: 'seller' } }]);
        sendInquiryEmail.mockRejectedValue(new Error('smtp down'));

        const inquiry = await createInquiry(meCtx, { listingId: 'lst-1', message: 'hi' });
        expect(inquiry).toEqual({ id: 'inq-1', quantityTonnes: null });
    });
});

describe('respondToInquiry (seller-only)', () => {
    const inq = (over: Record<string, unknown> = {}) => ({
        id: 'inq-1',
        status: 'PENDING',
        listing: { sellerTenantId: 'tenant-1', commodity: 'Wheat' },
        ...over,
    });

    it('the SELLER can accept a PENDING inquiry', async () => {
        repo.getInquiry.mockResolvedValue(inq() as never);
        repo.updateInquiryStatus.mockResolvedValue({ id: 'inq-1', status: 'ACCEPTED' } as never);
        await respondToInquiry(meCtx, 'inq-1', 'ACCEPTED');
        expect(repo.updateInquiryStatus).toHaveBeenCalledWith(mockDb, 'inq-1', 'ACCEPTED');
    });

    it('a NON-seller cannot respond → forbidden', async () => {
        repo.getInquiry.mockResolvedValue(inq({ listing: { sellerTenantId: 'tenant-9', commodity: 'Wheat' } }) as never);
        await expect(respondToInquiry(meCtx, 'inq-1', 'DECLINED')).rejects.toThrow(/your own listings/i);
        expect(repo.updateInquiryStatus).not.toHaveBeenCalled();
    });

    it('an already-answered inquiry → badRequest', async () => {
        repo.getInquiry.mockResolvedValue(inq({ status: 'ACCEPTED' }) as never);
        await expect(respondToInquiry(meCtx, 'inq-1', 'DECLINED')).rejects.toThrow(/not_pending/i);
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
