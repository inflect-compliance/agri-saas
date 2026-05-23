/**
 * GET /api/t/[tenantSlug]/evidence/metrics
 * Admin-only evidence + file storage metrics endpoint.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { getEvidenceMetrics } from '@/app-layer/usecases/evidence';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const metrics = await getEvidenceMetrics(ctx);
    return jsonResponse(metrics);
});
