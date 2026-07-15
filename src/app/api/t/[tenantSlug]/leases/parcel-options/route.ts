import { getTenantCtx } from '@/app-layer/context';
import { listTenantParcelOptions } from '@/app-layer/usecases/parcel-lease';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ tenantSlug: string }> };

// Parcel picker options for the Rent-page create modal (a lease is parcel-bound).
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const parcels = await listTenantParcelOptions(ctx);
    return jsonResponse({ parcels });
});
