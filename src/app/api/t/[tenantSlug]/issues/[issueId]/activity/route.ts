/** @deprecated Use /api/t/[tenantSlug]/tasks/[taskId]/activity */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getTaskActivity } from '@/app-layer/usecases/task';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const activity = await getTaskActivity(ctx, params.issueId);
    return jsonResponse(activity);
});
