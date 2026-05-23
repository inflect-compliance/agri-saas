import { getTenantCtx } from '@/app-layer/context';
import { setControlStatus } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { SetControlStatusSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(SetControlStatusSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const control = await setControlStatus(ctx, params.controlId, body.status);
    return jsonResponse(control);
}));
