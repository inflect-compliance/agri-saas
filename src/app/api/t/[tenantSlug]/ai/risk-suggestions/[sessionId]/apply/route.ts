import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { applySession } from '@/app-layer/usecases/risk-suggestions';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { ApplySessionSchema } from '@/app-layer/ai/risk-assessment/schemas';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(ApplySessionSchema, async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string; sessionId: string }> },
    body,
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await applySession(ctx, params.sessionId, body);
    return jsonResponse(result);
}));
