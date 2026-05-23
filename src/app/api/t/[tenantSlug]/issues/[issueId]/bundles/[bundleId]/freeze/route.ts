import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { freezeBundle } from '@/app-layer/usecases/issue';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string; bundleId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const bundle = await freezeBundle(ctx, params.bundleId);
    return jsonResponse(bundle);
});
