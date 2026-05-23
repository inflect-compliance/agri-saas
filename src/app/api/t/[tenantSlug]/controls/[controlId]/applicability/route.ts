import { getTenantCtx } from '@/app-layer/context';
import { setControlApplicability } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { SetControlApplicabilitySchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(SetControlApplicabilitySchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const control = await setControlApplicability(ctx, params.controlId, body.applicability, body.justification ?? null);
    return jsonResponse(control);
}));
