import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getFrameworkMappings } from '@/app-layer/usecases/mapping';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await getFrameworkMappings(ctx);
    return jsonResponse(result);
});
