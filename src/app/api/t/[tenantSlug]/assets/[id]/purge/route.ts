import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { purgeAsset } from '@/app-layer/usecases/asset';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await purgeAsset(ctx, params.id);
    return jsonResponse(result);
});
