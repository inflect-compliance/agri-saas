import { getTenantCtx } from '@/app-layer/context';
import { setControlOwner } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { SetControlOwnerSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(SetControlOwnerSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const control = await setControlOwner(ctx, params.controlId, body.ownerUserId);
    return jsonResponse(control);
}));
