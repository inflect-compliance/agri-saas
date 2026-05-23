import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { unmapControlFromRisk } from '@/app-layer/usecases/traceability';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string; riskId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await unmapControlFromRisk(ctx, params.controlId, params.riskId);
    return jsonResponse({ ok: true });
});
