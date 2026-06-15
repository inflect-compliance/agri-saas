import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { traceLot } from '@/app-layer/usecases/inventory';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Lot traceability walk — the food-safety recall query. Returns the lot's
 * genealogy both ways (ancestors = seed/input lots upstream, descendants =
 * harvest lots downstream) with the fields each lot touched.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; lotId: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'INVENTORY');
        const trace = await traceLot(ctx, params.lotId);
        return jsonResponse(trace);
    },
);
