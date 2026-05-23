import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { revokeAllTenantSessions } from '@/app-layer/usecases/session-security';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * POST /api/t/[tenantSlug]/security/sessions/revoke-all
 *
 * Revoke sessions for ALL users in this tenant.
 * Gated by `admin.members` (Epic D.3) — managing colleagues' active
 * sessions is a member-management action.
 * Audit logging is handled by the session-security usecase.
 */
export const POST = withApiErrorHandling(
    requirePermission('admin.members', async (_req: NextRequest, _routeArgs, ctx) => {
        const result = await revokeAllTenantSessions(ctx);
        return jsonResponse({
            success: true,
            message: `Sessions revoked for ${result.usersAffected} users.`,
            usersAffected: result.usersAffected,
        });
    }),
);
