import { getTenantCtx } from '@/app-layer/context';
import { listTenantLeases, createParcelLease } from '@/app-layer/usecases/parcel-lease';
import { TenantLeaseCreateSchema } from '@/app-layer/schemas/lease.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ tenantSlug: string }> };

// Tenant-wide lease register (the Rent page). Leases are still created/edited
// per-parcel from the parcel sheet too — these routes just decouple the
// register from the parcel path so the Rent page can manage every lease.
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const locationId = req.nextUrl.searchParams.get('locationId') ?? undefined;
    const leases = await listTenantLeases(ctx, { locationId });
    return jsonResponse({ leases });
});

export const POST = withApiErrorHandling(
    withValidatedBody(TenantLeaseCreateSchema, async (req, { params: paramsPromise }: Ctx, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const { parcelId, ...input } = body;
        const lease = await createParcelLease(ctx, parcelId, input);
        return jsonResponse(lease, { status: 201 });
    }),
);
