/**
 * GET /api/t/[tenantSlug]/evidence/retention/expiring?days=30
 * Lists evidence expiring within N days.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { listExpiringEvidence } from '@/app-layer/usecases/evidence-retention';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const days = parseInt(req.nextUrl.searchParams.get('days') || '30', 10);
    const result = await listExpiringEvidence(ctx, isNaN(days) ? 30 : days);
    return jsonResponse(result);
});
