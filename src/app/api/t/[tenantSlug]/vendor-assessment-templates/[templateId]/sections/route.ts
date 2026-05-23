/**
 * POST /api/t/[tenantSlug]/vendor-assessment-templates/[templateId]/sections
 * Body: AddVendorAssessmentTemplateSectionSchema
 */
import { getTenantCtx } from '@/app-layer/context';
import { addSection } from '@/app-layer/usecases/vendor-assessment-template';
import { withValidatedBody } from '@/lib/validation/route';
import { AddVendorAssessmentTemplateSectionSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(
    withValidatedBody(
        AddVendorAssessmentTemplateSectionSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; templateId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const section = await addSection(ctx, params.templateId, body);
            return jsonResponse(section, { status: 201 });
        },
    ),
);
