import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getPortfolioTrend } from '@/app-layer/usecases/risk-snapshot';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-9 — portfolio trend (daily PortfolioSnapshot series). */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const sinceParam = new URL(req.url).searchParams.get('since');
        return jsonResponse({ trend: await getPortfolioTrend(ctx, { since: sinceParam ? new Date(sinceParam) : undefined }) });
    },
);
