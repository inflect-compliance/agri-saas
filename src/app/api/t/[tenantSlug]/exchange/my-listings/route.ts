import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { listMyListings } from '@/app-layer/usecases/exchange';
import { toPublicListing, toPublicInquiry } from '@/lib/exchange/public-listing';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import type { NextRequest } from 'next/server';

/**
 * The caller-tenant's OWN listings (any status), each with its inquiries —
 * the seller's management view ("My listings"). Public projection: the
 * listing carries `isOwn: true`; inquiries expose only the coarse fields
 * (message / quantity / status), never the inquirer's tenant or user id.
 */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'EXCHANGE');
        const listings = await listMyListings(ctx);
        return jsonResponse(
            listings.map((l) => ({
                ...toPublicListing(l, ctx.tenantId),
                inquiries: l.inquiries.map((i) => toPublicInquiry(i, ctx.tenantId, false)),
            })),
        );
    },
);
