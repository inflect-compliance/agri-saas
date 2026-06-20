/**
 * GET /api/t/[tenantSlug]/reports/season-recap
 *
 * Returns the season-recap read-model (the "Year on the farm" card data).
 * Read-only — authorises via `assertCanRead` inside `getSeasonRecap`,
 * matching the privilege model of the other reports routes (which use
 * usecase-layer policy helpers, not `requirePermission`).
 *
 * Optional `?seasonId=` scopes to a specific season; omitted → the most
 * recent season, else all-time.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getSeasonRecap } from '@/app-layer/usecases/season-recap';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const QuerySchema = z.object({
    seasonId: z.string().optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const query = QuerySchema.parse(sp);

    const recap = await getSeasonRecap(ctx, query.seasonId);
    return jsonResponse(recap);
});
