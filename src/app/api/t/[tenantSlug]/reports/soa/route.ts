import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getSoA } from '@/app-layer/usecases/soa';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const SoAQuerySchema = z.object({
    framework: z.string().default('ISO27001'),
    includeEvidence: z.enum(['true', 'false']).default('false'),
    includeTasks: z.enum(['true', 'false']).default('false'),
    includeTests: z.enum(['true', 'false']).default('false'),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const query = SoAQuerySchema.parse(sp);

    const report = await getSoA(ctx, {
        framework: query.framework,
        includeEvidence: query.includeEvidence === 'true',
        includeTasks: query.includeTasks === 'true',
        includeTests: query.includeTests === 'true',
    });

    return jsonResponse(report);
});
