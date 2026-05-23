import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { createAuditPack, listAuditPacks } from '@/app-layer/usecases/audit-readiness';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const CreatePackSchema = z.object({
    auditCycleId: z.string().min(1),
    name: z.string().min(1).max(200),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const url = new URL(req.url);
    const cycleId = url.searchParams.get('cycleId') || undefined;
    return jsonResponse(await listAuditPacks(ctx, cycleId));
});

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = CreatePackSchema.parse(await req.json());
    return jsonResponse(await createAuditPack(ctx, body.auditCycleId, body.name), { status: 201 });
});
