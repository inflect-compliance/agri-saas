import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getRiskHistory } from '@/app-layer/usecases/risk-snapshot';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-9 — a single risk's snapshot history. */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const sinceParam = new URL(req.url).searchParams.get('since');
        return jsonResponse({ history: await getRiskHistory(ctx, params.id, { since: sinceParam ? new Date(sinceParam) : undefined }) });
    },
);
