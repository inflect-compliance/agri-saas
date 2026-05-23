import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getControl, updateControl } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateControlSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const control = await getControl(ctx, params.controlId);
    return jsonResponse(control);
});

export const PATCH = withApiErrorHandling(withValidatedBody(UpdateControlSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const control = await updateControl(ctx, params.controlId, body);
    return jsonResponse(control);
}));
