/**
 * POST /api/t/[tenantSlug]/vendor-assessment-reviews/[assessmentId]/review
 *
 * Body: ReviewVendorAssessmentSchema
 * Calls the prompt-5 reviewAssessment usecase. Transitions
 * SUBMITTED → REVIEWED.
 */
import { getTenantCtx } from '@/app-layer/context';
import { reviewAssessment } from '@/app-layer/usecases/vendor-assessment-review';
import { withValidatedBody } from '@/lib/validation/route';
import { ReviewVendorAssessmentSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import type { VendorCriticality } from '@prisma/client';

export const POST = withApiErrorHandling(
    withValidatedBody(
        ReviewVendorAssessmentSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; assessmentId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await reviewAssessment(ctx, params.assessmentId, {
                overrides: body.overrides,
                finalRiskRating:
                    body.finalRiskRating === undefined
                        ? undefined
                        : (body.finalRiskRating as VendorCriticality | null),
                reviewerNotes: body.reviewerNotes,
            });
            return jsonResponse({
                status: result.status,
                score: result.score,
                riskRating: result.riskRating,
                ratingOverridden: result.ratingOverridden,
                reviewedAt: result.reviewedAt.toISOString(),
                scoring: result.scoring,
            });
        },
    ),
);
