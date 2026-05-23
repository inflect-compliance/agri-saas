/**
 * @deprecated Use /api/t/[tenantSlug]/tasks/[taskId] instead.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getTask, updateTask } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await getTask(ctx, params.issueId);
    return jsonResponse(task);
});

export const PATCH = withApiErrorHandling(withValidatedBody(UpdateTaskSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await updateTask(ctx, params.issueId, body);
    return jsonResponse(task);
}));
