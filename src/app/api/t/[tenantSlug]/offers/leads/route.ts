import { getTenantCtx } from '@/app-layer/context';
import { createPromotionLead } from '@/app-layer/usecases/promotions';
import { CreatePromotionLeadSchema } from '@/app-layer/schemas/promotions.schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { EXCHANGE_INQUIRY_LIMIT } from '@/lib/security/rate-limit-middleware';

/**
 * Offers leads (#12) — company-promotions feed.
 *
 * POST → capture an "Ask for offer" lead against a GLOBAL promotion. The
 * usecase persists the lead then writes a best-effort confirmation
 * notification (fail-open). Lead-gen only: no provider portal / payment yet.
 */
export const POST = withApiErrorHandling(
    withValidatedBody(
        CreatePromotionLeadSchema,
        async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const lead = await createPromotionLead(ctx, {
                promotionId: body.promotionId,
                message: body.message,
                contextParcelId: body.contextParcelId ?? null,
                consent: body.consent,
            });
            return jsonResponse({ id: lead.id, status: lead.status }, { status: 201 });
        },
    ),
    // Reuse the inquiry limit — a lead can trigger a notification write, so cap
    // the burst the same way the Exchange inquiry endpoint does.
    { rateLimit: { config: EXCHANGE_INQUIRY_LIMIT, scope: 'offers-lead' } },
);
