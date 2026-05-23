import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { startVendorAssessment } from '@/app-layer/usecases/vendor';
import { withValidatedBody } from '@/lib/validation/route';
import { StartAssessmentSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(StartAssessmentSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const assessment = await startVendorAssessment(ctx, params.vendorId, body.templateKey);
    return jsonResponse(assessment, { status: 201 });
}));
