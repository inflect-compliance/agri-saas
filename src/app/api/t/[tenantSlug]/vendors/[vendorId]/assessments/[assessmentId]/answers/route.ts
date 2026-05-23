import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { saveAssessmentAnswers } from '@/app-layer/usecases/vendor';
import { withValidatedBody } from '@/lib/validation/route';
import { SaveAssessmentAnswersSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(SaveAssessmentAnswersSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string; assessmentId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await saveAssessmentAnswers(ctx, params.assessmentId, body.answers);
    return jsonResponse(result);
}));
