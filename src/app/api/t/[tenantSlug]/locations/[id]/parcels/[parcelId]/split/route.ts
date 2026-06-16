import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { splitParcel } from '@/app-layer/usecases/parcel';
import { SplitParcelSchema } from '@/app-layer/schemas/geo.schemas';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Split one parcel along a drawn line into the pieces the blade cuts it
 * into. The original is soft-deleted; each piece becomes a new parcel.
 */
export const POST = withApiErrorHandling(
    withValidatedBody(
        SplitParcelSchema,
        async (
            req,
            {
                params: paramsPromise,
            }: { params: Promise<{ tenantSlug: string; id: string; parcelId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const res = await splitParcel(ctx, params.parcelId, body.line);
            return jsonResponse(res, { status: 201 });
        },
    ),
);
