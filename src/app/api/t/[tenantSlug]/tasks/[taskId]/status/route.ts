import { getTenantCtx } from '@/app-layer/context';
import { setTaskStatus } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { SetTaskStatusSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(SetTaskStatusSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await setTaskStatus(ctx, params.taskId, body.status, body.resolution);
    return jsonResponse(task);
}));
