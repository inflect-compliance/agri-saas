import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { withdrawListing, fulfillListing } from '@/app-layer/usecases/exchange';
import { UpdateListingStatusSchema } from '@/app-layer/schemas/exchange.schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';

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
