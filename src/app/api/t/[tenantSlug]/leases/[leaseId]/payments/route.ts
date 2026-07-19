import { getTenantCtx } from '@/app-layer/context';
import { listLeasePayments, recordLeasePayment } from '@/app-layer/usecases/lease-payment';
import { LeasePaymentSchema } from '@/app-layer/schemas/lease.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ tenantSlug: string; leaseId: string }> };

/** Payments settled against one lease. */
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: Ctx) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const payments = await listLeasePayments(ctx, params.leaseId);
    return jsonResponse({ payments });
});

export const POST = withApiErrorHandling(
    withValidatedBody(LeasePaymentSchema, async (req, { params: paramsPromise }: Ctx, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const payment = await recordLeasePayment(ctx, params.leaseId, body);
        return jsonResponse(payment, { status: 201 });
    }),
);
