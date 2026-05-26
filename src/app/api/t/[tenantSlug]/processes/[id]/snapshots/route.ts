import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listProcessMapSnapshots } from '@/app-layer/usecases/process-map';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Epic P5-PR-A — Process map snapshots list.
 * Read-only; surfaces the version-history sidebar. Descending by
 * version. Capped at 200 in the repo.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        {
            params: paramsPromise,
        }: {
            params: Promise<{ tenantSlug: string; id: string }>;
        },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const snapshots = await listProcessMapSnapshots(ctx, params.id);
        return jsonResponse({ snapshots });
    },
);
