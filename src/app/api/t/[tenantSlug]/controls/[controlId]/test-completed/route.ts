import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { markControlTestCompleted } from '@/app-layer/usecases/control';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const control = await markControlTestCompleted(ctx, params.controlId);
    return jsonResponse(control);
});
