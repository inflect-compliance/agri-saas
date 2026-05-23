import { getTenantCtx } from '@/app-layer/context';
import { linkAssetToControl, unlinkAssetFromControl } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { MapControlAssetSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ tenantSlug: string; controlId: string }> };

export const POST = withApiErrorHandling(withValidatedBody(MapControlAssetSchema, async (req, { params: paramsPromise }: RouteParams, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const link = await linkAssetToControl(ctx, params.controlId, body.assetId);
    return jsonResponse(link, { status: 201 });
}));

export const DELETE = withApiErrorHandling(withValidatedBody(MapControlAssetSchema, async (req, { params: paramsPromise }: RouteParams, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await unlinkAssetFromControl(ctx, params.controlId, body.assetId);
    return jsonResponse(result);
}));
