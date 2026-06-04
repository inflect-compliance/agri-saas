import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getTask, updateTask, deleteTask } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await getTask(ctx, params.taskId);
    return jsonResponse(task);
});

export const PATCH = withApiErrorHandling(withValidatedBody(UpdateTaskSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await updateTask(ctx, params.taskId, body);
    return jsonResponse(task);
}));

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await deleteTask(ctx, params.taskId);
    return jsonResponse({ ok: true });
});
