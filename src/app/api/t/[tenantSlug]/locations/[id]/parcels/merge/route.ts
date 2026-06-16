import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { mergeParcels } from '@/app-layer/usecases/parcel';
import { MergeParcelsSchema } from '@/app-layer/schemas/geo.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Merge ≥2 of a location's parcels into one new parcel (their geometric
 * union). Originals are soft-deleted; the union becomes a fresh parcel.
 */
export const POST = withApiErrorHandling(
    withValidatedBody(
        MergeParcelsSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const created = await mergeParcels(ctx, params.id, body.parcelIds, body.name);
            return jsonResponse(created, { status: 201 });
        },
    ),
);
