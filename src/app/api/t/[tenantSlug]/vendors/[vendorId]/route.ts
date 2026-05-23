import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getVendor, updateVendor } from '@/app-layer/usecases/vendor';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateVendorSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const vendor = await getVendor(ctx, params.vendorId);
    return jsonResponse(vendor);
});

export const PATCH = withApiErrorHandling(withValidatedBody(UpdateVendorSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const vendor = await updateVendor(ctx, params.vendorId, body);
    return jsonResponse(vendor);
}));
