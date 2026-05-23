import { NextRequest } from 'next/server';
import { withApiErrorHandling } from '@/lib/errors/api';
import { getTenantCtx } from '@/app-layer/context';
import { getPolicyActivity } from '@/app-layer/usecases/policy';
import { jsonResponse } from '@/lib/api-response';

// GET /api/t/[tenantSlug]/policies/[id]/activity — policy activity feed
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const events = await getPolicyActivity(ctx, params.id);
    return jsonResponse(events);
});
