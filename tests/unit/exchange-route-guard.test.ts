/**
 * Route-level cross-tenant guard — the WIRE contract.
 *
 * The Exchange usecase throws forbidden/notFound on a cross-tenant write
 * (covered by exchange-usecase.test.ts). These tests drive the actual HTTP
 * handlers as a FOREIGN tenant and assert the wrapper maps those throws to
 * 403 / 404 — the contract a client actually sees, not just the usecase.
 *
 * getTenantCtx is mocked to the caller (foreign) tenant; the repository is
 * mocked to return rows owned by ANOTHER tenant; the real usecase + the real
 * withApiErrorHandling wrapper run in between.
 */
const getTenantCtxMock = jest.fn();

jest.mock('@/app-layer/context', () => ({
    __esModule: true,
    getTenantCtx: (...a: unknown[]) => getTenantCtxMock(...a),
}));
jest.mock('@/app-layer/usecases/modules', () => ({
    __esModule: true,
    assertModuleEnabled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn() }));

const mockDb = {} as Record<string, unknown>;
jest.mock('@/lib/db-context', () => ({
    __esModule: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantDb: jest.fn(async (_id: string, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/repositories/exchange', () => ({
    ExchangeRepository: {
        getListing: jest.fn(),
        updateListingStatus: jest.fn(),
        getInquiry: jest.fn(),
        updateInquiryStatus: jest.fn(),
    },
}));

import { NextRequest } from 'next/server';
import { ExchangeRepository } from '@/app-layer/repositories/exchange';
import { PATCH as PATCH_LISTING } from '@/app/api/t/[tenantSlug]/exchange/listings/[listingId]/route';
import { PATCH as PATCH_INQUIRY } from '@/app/api/t/[tenantSlug]/exchange/inquiries/[inquiryId]/route';
import { makeRequestContext } from '../helpers/make-context';

const repo = ExchangeRepository as jest.Mocked<typeof ExchangeRepository>;

function patchReq(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/t/tenant-b/exchange', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    // The CALLER is always tenant-b; the rows they target are owned by tenant-a.
    getTenantCtxMock.mockResolvedValue(
        makeRequestContext('EDITOR', { tenantId: 'tenant-b', userId: 'user-b' }),
    );
});

describe('PATCH /exchange/listings/[listingId] — cross-tenant', () => {
    it('403 when the listing belongs to ANOTHER tenant', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repo.getListing.mockResolvedValue({ id: 'lst-1', sellerTenantId: 'tenant-a', status: 'ACTIVE', commodity: 'Wheat' } as any);
        const res = await PATCH_LISTING(patchReq({ action: 'WITHDRAWN' }), {
            params: Promise.resolve({ tenantSlug: 'tenant-b', listingId: 'lst-1' }),
        });
        expect(res.status).toBe(403);
        expect(repo.updateListingStatus).not.toHaveBeenCalled();
    });

    it('404 when the listing does not exist', async () => {
        repo.getListing.mockResolvedValue(null);
        const res = await PATCH_LISTING(patchReq({ action: 'FULFILLED' }), {
            params: Promise.resolve({ tenantSlug: 'tenant-b', listingId: 'nope' }),
        });
        expect(res.status).toBe(404);
    });

    it('200 when the caller OWNS the listing (guard lets the owner through)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repo.getListing.mockResolvedValue({ id: 'lst-9', sellerTenantId: 'tenant-b', status: 'ACTIVE', commodity: 'Barley' } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repo.updateListingStatus.mockResolvedValue({ id: 'lst-9', status: 'WITHDRAWN' } as any);
        const res = await PATCH_LISTING(patchReq({ action: 'WITHDRAWN' }), {
            params: Promise.resolve({ tenantSlug: 'tenant-b', listingId: 'lst-9' }),
        });
        expect(res.status).toBe(200);
        expect(repo.updateListingStatus).toHaveBeenCalledWith(mockDb, 'lst-9', 'WITHDRAWN');
    });
});

describe('PATCH /exchange/inquiries/[inquiryId] — cross-tenant', () => {
    it('403 when responding to an inquiry on a listing the caller does NOT own', async () => {
        repo.getInquiry.mockResolvedValue({
            id: 'inq-1', status: 'PENDING', listing: { sellerTenantId: 'tenant-a', commodity: 'Wheat' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        const res = await PATCH_INQUIRY(patchReq({ action: 'ACCEPTED' }), {
            params: Promise.resolve({ tenantSlug: 'tenant-b', inquiryId: 'inq-1' }),
        });
        expect(res.status).toBe(403);
        expect(repo.updateInquiryStatus).not.toHaveBeenCalled();
    });

    it('404 when the inquiry does not exist', async () => {
        repo.getInquiry.mockResolvedValue(null);
        const res = await PATCH_INQUIRY(patchReq({ action: 'DECLINED' }), {
            params: Promise.resolve({ tenantSlug: 'tenant-b', inquiryId: 'nope' }),
        });
        expect(res.status).toBe(404);
    });
});
