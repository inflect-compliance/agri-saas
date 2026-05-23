/**
 * POST /api/t/[tenantSlug]/vendor-assessment-templates/[templateId]/sections/[sectionId]/questions
 * Body: AddVendorAssessmentTemplateQuestionSchema
 */
import { getTenantCtx } from '@/app-layer/context';
import { addQuestion } from '@/app-layer/usecases/vendor-assessment-template';
import { withValidatedBody } from '@/lib/validation/route';
import { AddVendorAssessmentTemplateQuestionSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import type { AnswerType } from '@prisma/client';

export const POST = withApiErrorHandling(
    withValidatedBody(
        AddVendorAssessmentTemplateQuestionSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{
                    tenantSlug: string;
                    templateId: string;
                    sectionId: string;
                }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const question = await addQuestion(ctx, params.sectionId, {
                prompt: body.prompt,
                answerType: body.answerType as AnswerType,
                required: body.required,
                weight: body.weight,
                optionsJson: body.optionsJson,
                scaleConfigJson: body.scaleConfigJson,
                riskPointsJson: body.riskPointsJson,
                sortOrder: body.sortOrder,
            });
            return jsonResponse(question, { status: 201 });
        },
    ),
);
