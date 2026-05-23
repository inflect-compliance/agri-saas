/**
 * GET /api/t/[tenantSlug]/evidence/retention/expired
 * Lists already-expired evidence.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { listExpiredEvidence } from '@/app-layer/usecases/evidence-retention';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await listExpiredEvidence(ctx);
    return jsonResponse(result);
});
