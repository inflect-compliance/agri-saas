import type { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { withdrawListing, fulfillListing, getListing } from '@/app-layer/usecases/exchange';
import { UpdateListingStatusSchema } from '@/app-layer/schemas/exchange.schemas';
import { toPublicListing } from '@/lib/exchange/public-listing';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';

/**
 * Read ONE listing by id (EXCHANGE module) — the deep-link / shared-link path.
 *
 *   GET → the PUBLIC projection of any tenant's listing (404 if missing).
 *
 * The browse feed only holds the current page, so a shared or emailed link to
 * a single listing needs this to fetch it standalone and open the detail Sheet.
 * The read is global by design (like the feed); `isOwn` is derived per viewer.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; listingId: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'EXCHANGE');
        const listing = await getListing(ctx, params.listingId);
        return jsonResponse(toPublicListing(listing, ctx.tenantId));
    },
);

/**
 * Update one of the caller-tenant's OWN listings (EXCHANGE module).
 *
 *   PATCH { action: 'WITHDRAWN' | 'FULFILLED' } → flip lifecycle status.
 *
 * The usecase re-loads the listing and asserts ctx.tenantId ===
 * sellerTenantId (the cross-tenant write guard) before mutating.
 */
export const PATCH = withApiErrorHandling(
    withValidatedBody(
        UpdateListingStatusSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; listingId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            await assertModuleEnabled(ctx, 'EXCHANGE');
            const updated =
                body.action === 'WITHDRAWN'
                    ? await withdrawListing(ctx, params.listingId)
                    : await fulfillListing(ctx, params.listingId);
            return jsonResponse({ id: updated.id, status: updated.status });
        },
    ),
);
