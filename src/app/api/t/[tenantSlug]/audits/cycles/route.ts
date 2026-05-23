import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { createAuditCycle, listAuditCycles } from '@/app-layer/usecases/audit-readiness';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const CreateCycleSchema = z.object({
    frameworkKey: z.enum(['ISO27001', 'NIS2']),
    frameworkVersion: z.string().min(1),
    name: z.string().min(1).max(200),
    periodStartAt: z.string().optional(),
    periodEndAt: z.string().optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await listAuditCycles(ctx));
});

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = CreateCycleSchema.parse(await req.json());
    return jsonResponse(await createAuditCycle(ctx, body), { status: 201 });
});
