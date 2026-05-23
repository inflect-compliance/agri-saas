import { getTenantCtx } from '@/app-layer/context';
import { markNotificationRead } from '@/app-layer/usecases/notification';
import { withValidatedBody } from '@/lib/validation/route';
import { EmptyBodySchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const PUT = withApiErrorHandling(withValidatedBody(EmptyBodySchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await markNotificationRead(ctx, params.id);
    return jsonResponse(result);
}));
