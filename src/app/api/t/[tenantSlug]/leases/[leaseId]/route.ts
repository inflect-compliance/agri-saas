import { getTenantCtx } from '@/app-layer/context';
import { updateParcelLease, deleteParcelLease } from '@/app-layer/usecases/parcel-lease';
import { ParcelLeaseSchema } from '@/app-layer/schemas/lease.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ tenantSlug: string; leaseId: string }> };

// Update / delete a lease by id, tenant-wide (the Rent page). The parcel-scoped
// route (…/parcels/[parcelId]/leases/[leaseId]) still works identically.
export const PATCH = withApiErrorHandling(
    withValidatedBody(ParcelLeaseSchema, async (req, { params: paramsPromise }: Ctx, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const lease = await updateParcelLease(ctx, params.leaseId, body);
        return jsonResponse(lease);
    }),
);

export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const res = await deleteParcelLease(ctx, params.leaseId);
    return jsonResponse(res);
});
