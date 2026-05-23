import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { revokeUserSessions } from '@/app-layer/usecases/session-security';
import { withApiErrorHandling } from '@/lib/errors/api';
import { RevokeSessionsInput } from '@/app-layer/schemas/mfa.schemas';
import { badRequest } from '@/lib/errors/types';
import { jsonResponse } from '@/lib/api-response';

/**
 * POST /api/t/[tenantSlug]/security/sessions/revoke-user
 *
 * Revoke sessions for a specific user in this tenant. Gated by
 * `admin.members` (Epic D.3) — managing colleagues' active sessions
 * is a member-management action.
 * Audit logging is handled by the session-security usecase.
 * Body: { targetUserId: "..." }
 *
 * Body parsing is inline rather than via `withValidatedBody` because
 * `requirePermission` already resolves the ctx and threads it as the
 * third argument; the two wrappers would otherwise have to share a
 * 4-tuple signature. The inline parse keeps the contract narrow.
 */
export const POST = withApiErrorHandling(
    requirePermission('admin.members', async (req: NextRequest, _routeArgs, ctx) => {
        const raw = await req.json().catch(() => ({}));
        const parsed = RevokeSessionsInput.safeParse(raw);
        if (!parsed.success) {
            throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');
        }
        const body = parsed.data;
        if (!body.targetUserId) {
            throw badRequest('targetUserId is required');
        }

        const result = await revokeUserSessions(ctx, body.targetUserId);

        return jsonResponse({
            success: true,
            message: 'User sessions revoked.',
            userId: result.userId,
            newSessionVersion: result.newSessionVersion,
        });
    }),
);
