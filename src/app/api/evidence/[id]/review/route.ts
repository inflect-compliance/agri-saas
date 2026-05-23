import { getLegacyCtx } from '@/app-layer/context';
import { reviewEvidence } from '@/app-layer/usecases/evidence';
import { withValidatedBody } from '@/lib/validation/route';
import { EvidenceReviewSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(EvidenceReviewSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const review = await reviewEvidence(ctx, params.id, body);
    return jsonResponse(review, { status: 201 });
}));
