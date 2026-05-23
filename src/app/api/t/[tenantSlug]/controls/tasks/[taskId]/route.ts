import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { updateControlTask, deleteControlTask } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateControlTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const PATCH = withApiErrorHandling(withValidatedBody(UpdateControlTaskSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await updateControlTask(ctx, params.taskId, body);
    return jsonResponse(task);
}));

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await deleteControlTask(ctx, params.taskId);
    return jsonResponse({ success: true });
});
