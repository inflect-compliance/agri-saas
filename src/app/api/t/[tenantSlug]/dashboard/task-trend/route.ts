import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getFarmTaskTrend } from '@/app-layer/usecases/farm-task';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * GET /api/t/:tenantSlug/dashboard/task-trend?days=14
 *
 * Daily farm-task "created vs completed" counts for the dashboard trendline.
 * `days` is clamped to [7, 60] (default 14) inside the usecase.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const days = parseInt(req.nextUrl.searchParams.get('days') ?? '14', 10);
        const trend = await getFarmTaskTrend(ctx, Number.isNaN(days) ? 14 : days);
        return jsonResponse({ trend });
    },
);
