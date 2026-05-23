import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getAsset, updateAsset, deleteAsset } from '@/app-layer/usecases/asset';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateAssetSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const asset = await getAsset(ctx, params.id);
    return jsonResponse(asset);
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdateAssetSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const asset = await updateAsset(ctx, params.id, body);
    return jsonResponse({ success: true, asset });
}));

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    await deleteAsset(ctx, params.id);
    return jsonResponse({ success: true });
});
