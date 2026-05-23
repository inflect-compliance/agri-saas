import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listControlRisks, mapControlToRisk } from '@/app-layer/usecases/traceability';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const LinkSchema = z.object({ riskId: z.string().min(1), rationale: z.string().optional() }).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await listControlRisks(ctx, params.controlId));
});

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = LinkSchema.parse(await req.json());
    return jsonResponse(await mapControlToRisk(ctx, params.controlId, body.riskId, body.rationale), { status: 201 });
});
