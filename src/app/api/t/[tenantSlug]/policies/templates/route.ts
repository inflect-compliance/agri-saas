import { NextRequest } from 'next/server';
import { withApiErrorHandling } from '@/lib/errors/api';
import { getTenantCtx } from '@/app-layer/context';
import * as policyUsecases from '@/app-layer/usecases/policy';
import { jsonResponse } from '@/lib/api-response';

// GET /api/t/[tenantSlug]/policies/templates — list global templates
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const templates = await policyUsecases.listPolicyTemplates(ctx);
    return jsonResponse(templates);
});
