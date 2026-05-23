import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getControl, updateControl } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateControlSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const control = await getControl(ctx, params.id);
    return jsonResponse(control);
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdateControlSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const control = await updateControl(ctx, params.id, body);
    return jsonResponse({ success: true, control });
}));
