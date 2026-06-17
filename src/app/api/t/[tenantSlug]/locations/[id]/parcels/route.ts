import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listLocationParcels } from '@/app-layer/usecases/location';
import { createParcel } from '@/app-layer/usecases/parcel';
import { CreateParcelSchema } from '@/app-layer/schemas/geo.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    // `?simplify=<degrees>` opts into ST_Simplify for a lighter display
    // payload on a many-field location; clamped to a sane range, omitted
    // (full geometry) otherwise — sketch/edit must keep exact geometry.
    const rawSimplify = req.nextUrl.searchParams.get('simplify');
    const simplify = rawSimplify != null ? Number.parseFloat(rawSimplify) : NaN;
    const opts = Number.isFinite(simplify) && simplify > 0
        ? { simplifyTolerance: Math.min(simplify, 0.01) }
        : {};
    const data = await listLocationParcels(ctx, params.id, opts);
    return jsonResponse(data);
});

export const POST = withApiErrorHandling(
    withValidatedBody(CreateParcelSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const created = await createParcel(ctx, params.id, body);
        return jsonResponse(created, { status: 201 });
    }),
);
