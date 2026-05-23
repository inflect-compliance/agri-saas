import { getTenantCtx } from '@/app-layer/context';
import { updateRisk } from '@/app-layer/usecases/risk';
import { withValidatedBody } from '@/lib/validation/route';
import { SetRiskStatusSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ tenantSlug: string; id: string }> };

export const PATCH = withApiErrorHandling(withValidatedBody(SetRiskStatusSchema, async (req, { params: paramsPromise }: RouteParams, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const risk = await updateRisk(ctx, params.id, { status: body.status });
    return jsonResponse(risk);
}));
