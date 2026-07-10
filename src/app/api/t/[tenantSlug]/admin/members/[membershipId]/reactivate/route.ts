import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { reactivateTenantMember } from '@/app-layer/usecases/tenant-admin';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * POST /api/t/:slug/admin/members/:membershipId/reactivate
 *
 * Restore a DEACTIVATED / REMOVED membership to ACTIVE (inverse of
 * /deactivate). Seat-gated in the usecase. Guarded by `admin.members`.
 */
export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; membershipId: string }>(
        'admin.members',
        async (_req: NextRequest, { params }, ctx) => {
            const result = await reactivateTenantMember(ctx, {
                membershipId: params.membershipId,
            });
            return jsonResponse(result);
        },
    ),
);
