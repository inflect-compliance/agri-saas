import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listLots, listLotsPaginated, createLot } from '@/app-layer/usecases/inventory';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { z } from 'zod';

const LotQuerySchema = z
    .object({
        itemId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
    })
    .strip();

const CreateLotSchema = z
    .object({
        itemId: z.string().min(1),
        lotCode: z.string().min(1).max(120),
        locationId: z.string().nullable().optional(),
        expiresAt: z.string().nullable().optional(),
        receivedAt: z.string().nullable().optional(),
        unitCostAmount: z.number().nonnegative().nullable().optional(),
        unitCostCurrency: z.string().max(8).nullable().optional(),
        initialQuantity: z.number().nonnegative().nullable().optional(),
    })
    .strip();

export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'INVENTORY');
        const q = LotQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
        // Dual-mode (mirrors /locations): ?limit=/?cursor= → cursor page,
        // bare GET → the full array (backward-compatible).
        if (q.limit || q.cursor) {
            const page = await listLotsPaginated(ctx, { limit: q.limit, cursor: q.cursor, itemId: q.itemId });
            return jsonResponse(page);
        }
        const lots = await listLots(ctx, { itemId: q.itemId });
        return jsonResponse(lots);
    },
);

export const POST = withApiErrorHandling(
    withValidatedBody(
        CreateLotSchema,
        async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            await assertModuleEnabled(ctx, 'INVENTORY');
            const lot = await createLot(ctx, body);
            return jsonResponse(lot, { status: 201 });
        },
    ),
);
