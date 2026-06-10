import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { computeVelocity } from '@/app-layer/usecases/risk-velocity';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-9 — portfolio + per-risk velocity (default 30-day window). */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const days = Number(new URL(req.url).searchParams.get('windowDays') ?? '30');
        return jsonResponse({ velocity: await computeVelocity(ctx, { windowDays: isFinite(days) ? days : 30 }) });
    },
);
