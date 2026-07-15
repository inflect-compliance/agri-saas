import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { getMarketNews } from '@/app-layer/usecases/trends';
import { TrendNewsQuerySchema } from '@/app-layer/schemas/trends.schemas';

/**
 * GET /api/t/[tenantSlug]/trends/news?category=&limit=
 *
 * Returns the GLOBAL aggregated agri-news feed (Trends → News tab), optionally
 * filtered by category ('market' | 'policy' | 'general' | 'all'), newest first.
 * Tenant-authed (getTenantCtx) — read-tier rate limiting applies at the edge.
 * The response is Redis-cached (1h) inside the usecase; the payload is
 * tenant-agnostic.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
    ) => {
        const params = await paramsPromise;
        // Authenticate + gate tenant access (payload itself is tenant-agnostic).
        await getTenantCtx(params, req);

        const query = TrendNewsQuerySchema.parse(
            Object.fromEntries(req.nextUrl.searchParams.entries()),
        );
        const payload = await getMarketNews(query.category, query.limit);
        return jsonResponse(payload);
    },
);
