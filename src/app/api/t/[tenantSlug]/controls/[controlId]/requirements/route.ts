import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { mapRequirementToControl, unmapRequirementFromControl, listControlMappings } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { MapRequirementSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

// GET — framework mappings for the control (#102 item 1, Mappings tab).
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const mappings = await listControlMappings(ctx, params.controlId);
    return jsonResponse(mappings);
});

export const POST = withApiErrorHandling(withValidatedBody(MapRequirementSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const mapping = await mapRequirementToControl(ctx, params.controlId, body.requirementId);
    return jsonResponse(mapping, { status: 201 });
}));

export const DELETE = withApiErrorHandling(withValidatedBody(MapRequirementSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; controlId: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    await unmapRequirementFromControl(ctx, params.controlId, body.requirementId);
    return jsonResponse({ success: true });
}));
