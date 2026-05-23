import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getSoA } from '@/app-layer/usecases/soa';
import { withApiErrorHandling } from '@/lib/errors/api';
import { runSoAChecks } from '@/app-layer/usecases/soa-checks';
import { jsonResponse } from '@/lib/api-response';

export { runSoAChecks };
export type { SoACheck, SoAChecksResult } from '@/app-layer/usecases/soa-checks';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const report = await getSoA(ctx, {
        includeEvidence: true,
        includeTasks: true,
        includeTests: true,
    });

    const result = runSoAChecks(report.entries);
    return jsonResponse(result);
});
