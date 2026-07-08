import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { getPlantingSoilSuitability } from '@/app-layer/usecases/soil';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Planting soil + suitability (PLANNING module).
 *   GET → the planting's parcel soil profile (modelled estimate) + an
 *         advisory crop-suitability verdict (good/caution/poor/unknown)
 *         computed against the variety's curated soil preferences.
 *         `{ soil, soilType, suitability: { flag, reason, reasons } }`.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; plantingId: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'PLANNING');
        const result = await getPlantingSoilSuitability(ctx, params.plantingId);
        return jsonResponse(result);
    },
);
