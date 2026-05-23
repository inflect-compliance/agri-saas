import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listTasks, createTask } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateTaskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const tasks = await listTasks(ctx);
    return jsonResponse(tasks);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateTaskSchema, async (req, _ctx, body) => {
    const ctx = await getLegacyCtx(req);
    const task = await createTask(ctx, body);
    return jsonResponse(task, { status: 201 });
}));
