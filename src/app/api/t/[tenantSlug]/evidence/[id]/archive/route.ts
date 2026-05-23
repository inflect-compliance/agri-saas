/**
 * POST /api/t/[tenantSlug]/evidence/[id]/archive
 * Archive evidence. ADMIN/EDITOR only.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { archiveEvidence } from '@/app-layer/usecases/evidence-retention';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> },
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await archiveEvidence(ctx, params.id);
    return jsonResponse(result);
});
