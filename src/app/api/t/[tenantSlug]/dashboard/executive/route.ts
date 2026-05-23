import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getExecutiveDashboard } from '@/app-layer/usecases/dashboard';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * GET /api/t/:tenantSlug/dashboard/executive
 *
 * Returns the full executive KPI payload — control coverage %, risk breakdown,
 * evidence expiry, policy/task/vendor summaries — in a single response.
 */
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const payload = await getExecutiveDashboard(ctx);
    return jsonResponse(payload);
});
