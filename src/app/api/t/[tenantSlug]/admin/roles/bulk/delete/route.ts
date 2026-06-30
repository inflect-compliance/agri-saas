/**
 * POST /api/t/:slug/admin/roles/bulk/delete
 *
 * Bulk soft-delete custom roles (the roles table's selection action-row
 * "Delete selected"). Guarded by `admin.manage` (same key as the single
 * DELETE /admin/roles/:roleId route); tenant-scoped + idempotent in the
 * usecase. Body: `{ roleIds: string[] }`. Returns `{ deleted: n }`.
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { bulkDeleteCustomRole } from '@/app-layer/usecases/custom-roles';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const BulkDeleteRoleSchema = z.object({
    roleIds: z.array(z.string().min(1)).min(1).max(100),
});

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const body = await req.json();
        const { roleIds } = BulkDeleteRoleSchema.parse(body);
        const result = await bulkDeleteCustomRole(ctx, { roleIds });
        return jsonResponse(result);
    }),
);
