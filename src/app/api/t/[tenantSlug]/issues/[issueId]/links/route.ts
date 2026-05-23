/** @deprecated Use /api/t/[tenantSlug]/tasks/[taskId]/links */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listTaskLinks, addTaskLink } from '@/app-layer/usecases/task';
import { withValidatedBody } from '@/lib/validation/route';
import { AddTaskLinkSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const links = await listTaskLinks(ctx, params.issueId);
    return jsonResponse(links);
});

export const POST = withApiErrorHandling(withValidatedBody(AddTaskLinkSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const link = await addTaskLink(ctx, params.issueId, body.entityType, body.entityId, body.relation);
    return jsonResponse(link, { status: 201 });
}));
