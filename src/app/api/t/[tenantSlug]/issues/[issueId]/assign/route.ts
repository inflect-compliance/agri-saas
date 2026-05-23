/** @deprecated Use /api/t/[tenantSlug]/tasks/[taskId]/assign */
import { getTenantCtx } from '@/app-layer/context';
import { assignTask } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { AssignTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(AssignTaskSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await assignTask(ctx, params.issueId, body.assigneeUserId);
    return jsonResponse(task);
}));
