/**
 * POST /api/t/[tenantSlug]/vendor-assessment-templates/[templateId]/reorder
 * Body: ReorderVendorAssessmentTemplateSchema
 */
import { getTenantCtx } from '@/app-layer/context';
import { reorderTemplate } from '@/app-layer/usecases/vendor-assessment-template';
import { withValidatedBody } from '@/lib/validation/route';
import { ReorderVendorAssessmentTemplateSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(
    withValidatedBody(
        ReorderVendorAssessmentTemplateSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; templateId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await reorderTemplate(
                ctx,
                params.templateId,
                body,
            );
            return jsonResponse(result);
        },
    ),
);
