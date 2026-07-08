import { getTenantCtx } from '@/app-layer/context';
import { createInsuranceLead } from '@/app-layer/usecases/insurance';
import { CreateInsuranceLeadSchema } from '@/app-layer/schemas/insurance.schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { EXCHANGE_INQUIRY_LIMIT } from '@/lib/security/rate-limit-middleware';

/**
 * Insurance quote leads (#13) — POST an "Ask for offer" request for a parcel.
 * The usecase persists the lead then writes a best-effort confirmation
 * notification. Lead-gen only.
 */
export const POST = withApiErrorHandling(
    withValidatedBody(
        CreateInsuranceLeadSchema,
        async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const lead = await createInsuranceLead(ctx, {
                parcelId: body.parcelId,
                locationId: body.locationId ?? null,
                message: body.message,
                risk: body.risk ?? null,
            });
            return jsonResponse({ id: lead.id, status: lead.status }, { status: 201 });
        },
    ),
    { rateLimit: { config: EXCHANGE_INQUIRY_LIMIT, scope: 'insurance-lead' } },
);
