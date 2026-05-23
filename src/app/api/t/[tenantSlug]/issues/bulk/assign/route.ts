import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { bulkAssign } from '@/app-layer/usecases/issue';
import { withValidatedBody } from '@/lib/validation/route';
import { BulkAssignSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(BulkAssignSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await bulkAssign(ctx, body.taskIds, body.assigneeUserId);
    return jsonResponse({ updated: result.count });
}));
