import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { listActiveListings } from '@/app-layer/usecases/exchange';
import { toPublicListing } from '@/lib/exchange/public-listing';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Exchange listings — the cross-tenant browse feed (EXCHANGE module).
 *
 *   GET → ACTIVE listings across ALL tenants, PUBLIC projection only
 *         (no sellerUserId, no raw owning-tenant id → an opaque `isOwn`
 *         flag instead; no encrypted/private fields — there are none).
 *
 * Read-tier rate limiting (GAP-17) applies automatically at the Edge for
 * `/api/t/<slug>/...` GETs. Browse is FREE (no plan gate) — the network
 * effect depends on open access; the per-tenant EXCHANGE module toggle is
 * the only gate, enforced here via `assertModuleEnabled`.
 */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'EXCHANGE');
        const listings = await listActiveListings(ctx);
        return jsonResponse(listings.map((l) => toPublicListing(l, ctx.tenantId)));
    },
);
