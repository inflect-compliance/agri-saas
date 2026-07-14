import { getTenantCtx } from '@/app-layer/context';
import { listParcelLeases, createParcelLease } from '@/app-layer/usecases/parcel-lease';
import { ParcelLeaseSchema } from '@/app-layer/schemas/lease.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ tenantSlug: string; id: string; parcelId: string }> };

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const leases = await listParcelLeases(ctx, params.parcelId);
    return jsonResponse({ leases });
});

export const POST = withApiErrorHandling(
    withValidatedBody(ParcelLeaseSchema, async (req, { params: paramsPromise }: Ctx, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const lease = await createParcelLease(ctx, params.parcelId, body);
        return jsonResponse(lease, { status: 201 });
    }),
);
