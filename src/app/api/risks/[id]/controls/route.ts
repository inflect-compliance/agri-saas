import { getLegacyCtx } from '@/app-layer/context';
import { linkControlToRisk } from '@/app-layer/usecases/risk';
import { withValidatedBody } from '@/lib/validation/route';
import { LinkRiskControlSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(withValidatedBody(LinkRiskControlSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const result = await linkControlToRisk(ctx, params.id, body.controlId);
    return jsonResponse(result, { status: 201 });
}));
