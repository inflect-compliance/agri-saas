/**
 * GET /api/t/[tenantSlug]/tests/plans — List ALL test plans across all controls
 * Supports filters: q, status, controlId, due (overdue/next7d)
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listAllTestPlans } from '@/app-layer/usecases/due-planning';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { normalizeQ } from '@/lib/filters/query-helpers';
import { jsonResponse } from '@/lib/api-response';

const TestPlanQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
    status: z.string().optional(),
    controlId: z.string().optional(),
    due: z.enum(['overdue', 'next7d']).optional(),
    q: z.string().optional().transform(normalizeQ),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const query = TestPlanQuerySchema.parse(sp);

    const plans = await listAllTestPlans(ctx, {
        status: query.status,
        controlId: query.controlId,
        due: query.due,
        q: query.q,
    });
    return jsonResponse(plans);
});
