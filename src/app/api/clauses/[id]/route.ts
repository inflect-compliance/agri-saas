import { getLegacyCtx } from '@/app-layer/context';
import { updateClauseProgress } from '@/app-layer/usecases/clause';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateClauseProgressSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const PUT = withApiErrorHandling(withValidatedBody(UpdateClauseProgressSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const result = await updateClauseProgress(ctx, params.id, body);
    return jsonResponse(result);
}));
