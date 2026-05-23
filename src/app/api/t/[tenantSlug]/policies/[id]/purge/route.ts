import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { purgePolicy } from '@/app-layer/usecases/policy';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await purgePolicy(ctx, params.id);
    return jsonResponse(result);
});
