import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listAssets, createAsset } from '@/app-layer/usecases/asset';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateAssetSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const assets = await listAssets(ctx);
    return jsonResponse(assets);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateAssetSchema, async (req, _ctx, body) => {
    const ctx = await getLegacyCtx(req);
    const asset = await createAsset(ctx, body);
    return jsonResponse(asset, { status: 201 });
}));
