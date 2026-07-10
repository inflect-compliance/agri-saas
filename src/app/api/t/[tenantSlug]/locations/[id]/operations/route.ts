import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { createFieldOperation, listLocationOperations } from '@/app-layer/usecases/field-operation';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateFieldOperationSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const operations = await listLocationOperations(ctx, params.id);
    return jsonResponse(operations);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateFieldOperationSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    // Offline exactly-once — the outbox replays a queued spray job with its
    // item id as the Idempotency-Key; the usecase dedupes on it so a re-send
    // over flaky rural LTE returns the original task, not a duplicate.
    const idempotencyKey = req.headers.get('Idempotency-Key') || undefined;
    const result = await createFieldOperation(ctx, params.id, body, idempotencyKey);
    return jsonResponse(result, { status: 201 });
}));
