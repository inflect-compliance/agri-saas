import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { getPriceTrends } from '@/app-layer/usecases/trends';
import { TrendPricesQuerySchema } from '@/app-layer/schemas/trends.schemas';

/**
 * GET /api/t/[tenantSlug]/trends/prices?commodity=&range=
 *
 * Returns the GLOBAL market-price series for one commodity, grouped by
 * (source, region) so the chart can split lines by unit/currency. Tenant-authed
 * (getTenantCtx) — read-tier rate limiting applies at the edge. The response is
 * Redis-cached (6h) inside the usecase.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
    ) => {
        const params = await paramsPromise;
        // Authenticate + gate tenant access (payload itself is tenant-agnostic).
        await getTenantCtx(params, req);

        const query = TrendPricesQuerySchema.parse(
            Object.fromEntries(req.nextUrl.searchParams.entries()),
        );
        const payload = await getPriceTrends(query.commodity, query.range);
        return jsonResponse(payload);
    },
);
