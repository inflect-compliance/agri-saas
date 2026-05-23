import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getAsset, updateAsset, deleteAsset } from '@/app-layer/usecases/asset';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateAssetSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const asset = await getAsset(ctx, params.id);
    return jsonResponse(asset);
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdateAssetSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const asset = await updateAsset(ctx, params.id, body);
    return jsonResponse({ success: true, asset });
}));

export const PATCH = PUT;

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await deleteAsset(ctx, params.id);
    return jsonResponse({ success: true });
});
