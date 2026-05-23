import { getTenantCtx } from '@/app-layer/context';
import { assignTask } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { AssignTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(AssignTaskSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await assignTask(ctx, params.taskId, body.assigneeUserId);
    return jsonResponse(task);
}));
