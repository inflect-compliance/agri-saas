import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listControlTasks, createControlTask } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateControlTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const tasks = await listControlTasks(ctx, params.controlId);
    return jsonResponse(tasks);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateControlTaskSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const task = await createControlTask(ctx, params.controlId, body);
    return jsonResponse(task, { status: 201 });
}));
