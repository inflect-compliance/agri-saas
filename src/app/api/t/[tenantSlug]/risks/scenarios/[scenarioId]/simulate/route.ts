import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { simulateScenario } from '@/app-layer/usecases/risk-scenario';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-4 — run the Monte Carlo with the scenario's overrides; return comparison. */
export const POST = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; scenarioId: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const comparison = await simulateScenario(ctx, params.scenarioId);
        return jsonResponse({ success: true, comparison });
    },
);
