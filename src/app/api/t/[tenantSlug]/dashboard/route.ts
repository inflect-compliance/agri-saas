import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getDashboardData } from '@/app-layer/usecases/dashboard';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const data = await getDashboardData(ctx);
    return jsonResponse(data);
});
