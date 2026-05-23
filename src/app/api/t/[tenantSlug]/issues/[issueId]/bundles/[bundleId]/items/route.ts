import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listBundleItems, addBundleItem } from '@/app-layer/usecases/issue';
import { withValidatedBody } from '@/lib/validation/route';
import { AddBundleItemSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string; bundleId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const items = await listBundleItems(ctx, params.bundleId);
    return jsonResponse(items);
});

export const POST = withApiErrorHandling(withValidatedBody(AddBundleItemSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; issueId: string; bundleId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const item = await addBundleItem(ctx, params.bundleId, body);
    return jsonResponse(item, { status: 201 });
}));
