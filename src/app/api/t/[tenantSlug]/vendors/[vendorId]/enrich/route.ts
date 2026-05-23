import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { enrichVendor } from '@/app-layer/usecases/vendor';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; vendorId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const vendor = await enrichVendor(ctx, params.vendorId);
    return jsonResponse(vendor);
});
