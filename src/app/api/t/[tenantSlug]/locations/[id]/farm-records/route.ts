/**
 * GET /api/t/[tenantSlug]/locations/[id]/farm-records
 *
 * The location's Farm-records register — the generated ДНЕВНИК PDFs (newest
 * first) plus a non-blocking completeness nudge. Read-only, gated via
 * `assertCanRead` inside the usecase.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listFarmRecords } from '@/app-layer/usecases/farm-record-register';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        return jsonResponse(await listFarmRecords(ctx, params.id));
    },
);
