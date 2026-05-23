/**
 * POST /api/t/[tenantSlug]/tests/plans/[planId]/automation-run
 * Creates a completed test run from an automation/integration result.
 * Body: { result, notes?, integrationResultId?, evidenceLinks?[] }
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { createAutomatedTestRun } from '@/app-layer/usecases/control-test';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; planId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = await req.json();
    if (!body.result || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(body.result)) {
        return jsonResponse({ error: 'result is required: PASS | FAIL | INCONCLUSIVE' }, { status: 400 });
    }
    const run = await createAutomatedTestRun(ctx, params.planId, body);
    return jsonResponse(run, { status: 201 });
});
