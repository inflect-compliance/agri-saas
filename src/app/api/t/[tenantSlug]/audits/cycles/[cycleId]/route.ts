import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getAuditCycle, updateAuditCycle, previewDefaultPack } from '@/app-layer/usecases/audit-readiness';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const UpdateCycleSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(['PLANNING', 'IN_PROGRESS', 'READY', 'COMPLETE']).optional(),
    periodStartAt: z.string().optional(),
    periodEndAt: z.string().optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; cycleId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (action === 'default-pack-preview') {
        return jsonResponse(await previewDefaultPack(ctx, params.cycleId));
    }

    return jsonResponse(await getAuditCycle(ctx, params.cycleId));
});

export const PATCH = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; cycleId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = UpdateCycleSchema.parse(await req.json());
    return jsonResponse(await updateAuditCycle(ctx, params.cycleId, body));
});
