/** @deprecated Use /api/t/[tenantSlug]/tasks/[taskId]/comments */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listTaskComments, addTaskComment } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { AddTaskCommentSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const comments = await listTaskComments(ctx, params.issueId);
    return jsonResponse(comments);
});

export const POST = withApiErrorHandling(withValidatedBody(AddTaskCommentSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const comment = await addTaskComment(ctx, params.issueId, body.body);
    return jsonResponse(comment, { status: 201 });
}));
