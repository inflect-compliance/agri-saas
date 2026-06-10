import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getScenario, archiveScenario } from '@/app-layer/usecases/risk-scenario';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-4 — single scenario: GET detail, DELETE archives. */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; scenarioId: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        return jsonResponse({ scenario: await getScenario(ctx, params.scenarioId) });
    },
);

export const DELETE = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; scenarioId: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await archiveScenario(ctx, params.scenarioId);
        return jsonResponse({ success: true });
    },
);
