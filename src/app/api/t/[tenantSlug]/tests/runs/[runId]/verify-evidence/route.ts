/**
 * GET /api/t/[tenantSlug]/tests/runs/[runId]/verify-evidence
 * Re-computes hashes for all FILE-kind evidence and checks against stored values.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { verifyRunEvidence } from '@/app-layer/usecases/test-hardening';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; runId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await verifyRunEvidence(ctx, params.runId);
    return jsonResponse(result);
});
