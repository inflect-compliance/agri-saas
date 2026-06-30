/**
 * POST /api/t/:slug/admin/api-keys/bulk/delete
 *
 * Bulk-revoke API keys (the API keys table's selection action-row "Revoke
 * selected"). Guarded by `admin.manage` — the same permission as the single
 * revoke route — tenant-scoped + idempotent in the usecase. Body:
 * `{ apiKeyIds: string[] }`. Returns `{ revoked: n }`.
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { bulkRevokeApiKey } from '@/app-layer/usecases/api-keys';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const BulkRevokeApiKeySchema = z.object({
    apiKeyIds: z.array(z.string().min(1)).min(1).max(100),
});

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const body = await req.json();
        const { apiKeyIds } = BulkRevokeApiKeySchema.parse(body);
        const result = await bulkRevokeApiKey(ctx, apiKeyIds);
        return jsonResponse(result);
    }),
);
