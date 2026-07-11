import { getTenantCtx } from '@/app-layer/context';
import { markOperationParcel } from '@/app-layer/usecases/field-operation';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateOperationParcelSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const PATCH = withApiErrorHandling(withValidatedBody(UpdateOperationParcelSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; taskId: string; lineId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    // Optimistic lock — a mark queued offline replays with the row version it
    // saw as `If-Match`. A stale version → 409 STALE_DATA (the usecase throws).
    const ifMatch = req.headers.get('If-Match');
    const parsedVersion = ifMatch != null && ifMatch !== '' ? Number.parseInt(ifMatch, 10) : NaN;
    const expectedVersion = Number.isInteger(parsedVersion) ? parsedVersion : undefined;
    const result = await markOperationParcel(ctx, params.taskId, params.lineId, body.status, body.note ?? undefined, expectedVersion);
    return jsonResponse(result);
}));
