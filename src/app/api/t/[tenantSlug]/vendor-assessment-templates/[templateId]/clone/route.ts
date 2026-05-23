/**
 * POST /api/t/[tenantSlug]/vendor-assessment-templates/[templateId]/clone
 * Body: CloneVendorAssessmentTemplateSchema
 */
import { getTenantCtx } from '@/app-layer/context';
import { cloneTemplate } from '@/app-layer/usecases/vendor-assessment-template';
import { withValidatedBody } from '@/lib/validation/route';
import { CloneVendorAssessmentTemplateSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(
    withValidatedBody(
        CloneVendorAssessmentTemplateSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; templateId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const cloned = await cloneTemplate(ctx, params.templateId, body);
            return jsonResponse(cloned, { status: 201 });
        },
    ),
);
