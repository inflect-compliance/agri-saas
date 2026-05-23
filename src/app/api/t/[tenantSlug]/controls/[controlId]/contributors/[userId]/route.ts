import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { removeContributor } from '@/app-layer/usecases/control';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string; userId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await removeContributor(ctx, params.controlId, params.userId);
    return jsonResponse({ success: true });
});
