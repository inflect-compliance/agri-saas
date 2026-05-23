import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listAssetRisks, mapAssetToRisk } from '@/app-layer/usecases/traceability';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const LinkSchema = z.object({
    riskId: z.string().min(1),
    exposureLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    rationale: z.string().optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await listAssetRisks(ctx, params.id));
});

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = LinkSchema.parse(await req.json());
    return jsonResponse(await mapAssetToRisk(ctx, params.id, body.riskId, body.exposureLevel, body.rationale), { status: 201 });
});
