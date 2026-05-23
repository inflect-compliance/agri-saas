import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getRisk, updateRisk, deleteRisk } from '@/app-layer/usecases/risk';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateRiskSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const risk = await getRisk(ctx, params.id);
    return jsonResponse(risk);
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdateRiskSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const risk = await updateRisk(ctx, params.id, body);
    return jsonResponse({ success: true, risk });
}));

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    await deleteRisk(ctx, params.id);
    return jsonResponse({ success: true });
});
