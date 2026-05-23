import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { generateRiskSuggestions } from '@/app-layer/usecases/risk-suggestions';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { RiskAssessmentInputSchema } from '@/app-layer/ai/risk-assessment/schemas';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(RiskAssessmentInputSchema, async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
    body,
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const input = { frameworks: body.frameworks ?? [], assetIds: body.assetIds ?? [], context: body.context };
    const result = await generateRiskSuggestions(ctx, input);
    return jsonResponse(result, { status: 201 });
}));
