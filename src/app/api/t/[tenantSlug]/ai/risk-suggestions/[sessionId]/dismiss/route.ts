import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { dismissSession } from '@/app-layer/usecases/risk-suggestions';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string; sessionId: string }> },
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await dismissSession(ctx, params.sessionId);
    return jsonResponse(result);
});
