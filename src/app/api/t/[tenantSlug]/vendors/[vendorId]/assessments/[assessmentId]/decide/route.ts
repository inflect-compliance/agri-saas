import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { decideVendorAssessment } from '@/app-layer/usecases/vendor';
import { withValidatedBody } from '@/lib/validation/route';
import { DecideAssessmentSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(DecideAssessmentSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string; assessmentId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const assessment = await decideVendorAssessment(ctx, params.assessmentId, body.decision, body.notes);
    return jsonResponse(assessment);
}));
