/**
 * POST /api/t/:slug/controls/bulk/delete
 *
 * Bulk soft-delete controls (the controls table selection action-row).
 * Permission (ADMIN) + tenant isolation (and the global-library guard) are
 * enforced in `bulkDeleteControl`. Body: `{ controlIds: string[] }`. Returns
 * `{ deleted: n }`.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { bulkDeleteControl } from '@/app-layer/usecases/control';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { z } from 'zod';

const BulkDeleteControlSchema = z.object({
    controlIds: z.array(z.string().min(1)).min(1).max(100),
});

export const POST = withApiErrorHandling(
    withValidatedBody(
        BulkDeleteControlSchema,
        async (
            req: NextRequest,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await bulkDeleteControl(ctx, body.controlIds);
            return jsonResponse(result);
        },
    ),
);
