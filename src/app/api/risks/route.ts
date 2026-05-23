import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listRisks, createRisk } from '@/app-layer/usecases/risk';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateRiskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const risks = await listRisks(ctx);
    return jsonResponse(risks);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateRiskSchema, async (req, _ctx, body) => {
    const ctx = await getLegacyCtx(req);
    const risk = await createRisk(ctx, body);
    return jsonResponse(risk, { status: 201 });
}));
