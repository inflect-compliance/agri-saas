/**
 * GET /api/t/[tenantSlug]/tests/readiness — Framework test readiness scores
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { computeTestReadiness } from '@/app-layer/usecases/test-readiness';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const readiness = await computeTestReadiness(ctx);
    return jsonResponse(readiness);
});
