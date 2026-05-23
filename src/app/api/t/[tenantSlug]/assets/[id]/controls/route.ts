import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listAssetControls, mapAssetToControl } from '@/app-layer/usecases/traceability';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const LinkSchema = z.object({
    controlId: z.string().min(1),
    coverageType: z.enum(['FULL', 'PARTIAL', 'UNKNOWN']).optional(),
    rationale: z.string().optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await listAssetControls(ctx, params.id));
});

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = LinkSchema.parse(await req.json());
    return jsonResponse(await mapAssetToControl(ctx, params.id, body.controlId, body.coverageType, body.rationale), { status: 201 });
});
