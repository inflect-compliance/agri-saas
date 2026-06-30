/**
 * POST /api/t/:slug/risks/bulk/delete
 *
 * Bulk soft-delete risks (the risks table selection action-row). Permission
 * (ADMIN) + tenant isolation are enforced in `bulkDeleteRisk`. Body:
 * `{ riskIds: string[] }`. Returns `{ deleted: n }`.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { bulkDeleteRisk } from '@/app-layer/usecases/risk';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { z } from 'zod';

const BulkDeleteRiskSchema = z.object({
    riskIds: z.array(z.string().min(1)).min(1).max(100),
});

export const POST = withApiErrorHandling(
    withValidatedBody(
        BulkDeleteRiskSchema,
        async (
            req: NextRequest,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await bulkDeleteRisk(ctx, body.riskIds);
            return jsonResponse(result);
        },
    ),
);
