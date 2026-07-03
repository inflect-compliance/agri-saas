import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { respondToInquiry } from '@/app-layer/usecases/exchange';
import { RespondToInquirySchema } from '@/app-layer/schemas/exchange.schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';

/**
 * Respond to an inquiry on one of the caller-tenant's OWN listings
 * (EXCHANGE module).
 *
 *   PATCH { action: 'ACCEPTED' | 'DECLINED' }
 *
 * The usecase loads the inquiry, asserts the inquiry's listing.sellerTenantId
 * === ctx.tenantId (only the seller responds), and requires PENDING.
 */
export const PATCH = withApiErrorHandling(
    withValidatedBody(
        RespondToInquirySchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; inquiryId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            await assertModuleEnabled(ctx, 'EXCHANGE');
            const updated = await respondToInquiry(ctx, params.inquiryId, body.action);
            return jsonResponse({ id: updated.id, status: updated.status });
        },
    ),
);
