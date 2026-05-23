import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { coverageSummary } from '@/app-layer/usecases/traceability';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * GET /api/t/[tenantSlug]/coverage
 *
 * Returns the asset–control–risk coverage summary for the tenant.
 * Used by the Coverage Dashboard page.
 */
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const data = await coverageSummary(ctx);
    return jsonResponse(data);
});
