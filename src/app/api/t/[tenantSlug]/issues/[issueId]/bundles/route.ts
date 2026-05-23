import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listBundles, createBundle } from '@/app-layer/usecases/issue';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateBundleSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const bundles = await listBundles(ctx, params.issueId);
    return jsonResponse(bundles);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateBundleSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const bundle = await createBundle(ctx, params.issueId, body.name);
    return jsonResponse(bundle, { status: 201 });
}));
