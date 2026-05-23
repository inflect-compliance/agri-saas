import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { bulkSetStatus } from '@/app-layer/usecases/issue';
import { withValidatedBody } from '@/lib/validation/route';
import { BulkStatusSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(BulkStatusSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await bulkSetStatus(ctx, body.taskIds, body.status, body.resolution);
    return jsonResponse({ updated: result.count });
}));
