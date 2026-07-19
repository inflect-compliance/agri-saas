import { getTenantCtx } from '@/app-layer/context';
import { deleteLeasePayment } from '@/app-layer/usecases/lease-payment';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ tenantSlug: string; leaseId: string; paymentId: string }> };

/** Soft-delete a mis-keyed settlement so it stops skewing the roll. */
export const DELETE = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const res = await deleteLeasePayment(ctx, params.paymentId);
    return jsonResponse(res);
});
