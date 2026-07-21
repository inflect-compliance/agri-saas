import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { assertPlatformSupport } from '@/lib/auth/platform-support';
import {
    updatePromotion,
    setPromotionPublished,
    deletePromotion,
} from '@/app-layer/usecases/promotion-admin';
import {
    UpdatePromotionSchema,
    SetPublishedSchema,
} from '@/app-layer/schemas/promotion-admin.schemas';


/** Route params — the tenant slug plus this route's own `[id]` segment. */
type IdParams = { tenantSlug: string; id: string };

/**
 * Edit / publish / delete a single global promotion (#12).
 * See the sibling `../route.ts` for the two-gate rationale.
 */

export const PATCH = withApiErrorHandling(
    requirePermission<IdParams>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        assertPlatformSupport(ctx);
        const { id } = params;
        const input = UpdatePromotionSchema.parse(await req.json());
        const promotion = await updatePromotion(ctx, id, input);
        return jsonResponse({ id: promotion.id });
    }),
);

/**
 * Publish / unpublish. A separate verb from PATCH because this is the moment
 * content becomes visible to every tenant — it deserves its own audited action
 * rather than being buried in a field diff.
 */
export const PUT = withApiErrorHandling(
    requirePermission<IdParams>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        assertPlatformSupport(ctx);
        const { id } = params;
        const { published } = SetPublishedSchema.parse(await req.json());
        const promotion = await setPromotionPublished(ctx, id, published);
        return jsonResponse({ id: promotion.id, publishedAt: promotion.publishedAt });
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<IdParams>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        assertPlatformSupport(ctx);
        const { id } = params;
        await deletePromotion(ctx, id);
        return new NextResponse(null, { status: 204 });
    }),
);
