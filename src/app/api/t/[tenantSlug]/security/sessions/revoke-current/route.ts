import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { revokeCurrentSession } from '@/app-layer/usecases/session-security';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * POST /api/t/[tenantSlug]/security/sessions/revoke-current
 *
 * Revokes the current user's own sessions.
 * Audit logging is handled by the session-security usecase.
 */
export const POST = withApiErrorHandling(async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await revokeCurrentSession(ctx);

    return jsonResponse({
        success: true,
        message: 'All your sessions have been revoked. You will need to sign in again.',
        userId: result.userId,
        newSessionVersion: result.newSessionVersion,
    });
});
