import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getLot } from '@/app-layer/usecases/inventory';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; lotId: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'INVENTORY');
        const lot = await getLot(ctx, params.lotId);
        return jsonResponse(lot);
    },
);
