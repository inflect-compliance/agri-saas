/** @deprecated Use /api/t/[tenantSlug]/tasks with controlId filter */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listTasksByControl } from '@/app-layer/usecases/task';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const tasks = await listTasksByControl(ctx, params.controlId);
    return jsonResponse(tasks);
});
