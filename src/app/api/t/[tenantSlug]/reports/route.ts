import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getReports } from '@/app-layer/usecases/report';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const reports = await getReports(ctx);
    return jsonResponse(reports);
});
