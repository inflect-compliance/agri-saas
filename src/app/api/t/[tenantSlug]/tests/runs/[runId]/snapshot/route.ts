/**
 * POST /api/t/[tenantSlug]/tests/runs/[runId]/snapshot
 * Creates immutable snapshot of a test run in an audit pack.
 * Body: { auditPackId: string }
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { snapshotTestRun } from '@/app-layer/usecases/test-hardening';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; runId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = await req.json();
    if (!body.auditPackId) {
        return jsonResponse({ error: 'auditPackId is required' }, { status: 400 });
    }
    const item = await snapshotTestRun(ctx, params.runId, body.auditPackId);
    return jsonResponse(item, { status: 201 });
});
