/**
 * POST /api/t/[tenantSlug]/vendor-assessment-reviews/[assessmentId]/close
 *
 * Body (optional): { notes?: string | null }
 * Transitions REVIEWED → CLOSED.
 */
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { closeAssessment } from '@/app-layer/usecases/vendor-assessment-review';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

const CloseBodySchema = z
    .object({
        notes: z.string().max(10000).nullable().optional(),
    })
    .strip();

export const POST = withApiErrorHandling(
    withValidatedBody(
        CloseBodySchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; assessmentId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await closeAssessment(
                ctx,
                params.assessmentId,
                body.notes,
            );
            return jsonResponse({
                status: result.status,
                closedAt: result.closedAt.toISOString(),
            });
        },
    ),
);
