/**
 * /api/invites/:token
 *
 * GET  — preview an invite (sign-in gated, any tenant; returns preview or null).
 * POST — redeem an invite (sign-in gated, any tenant).
 *
 * These routes are intentionally excluded from the tenant-permission
 * coverage guardrail (see EXCLUDED_ROUTES in api-permission-coverage.test.ts)
 * because there is no tenant-scope in scope at preview/redeem time — the
 * user is not yet a member of the target tenant.
 *
 * Rate limited: INVITE_REDEEM_LIMIT (10/min per IP).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { previewInviteByToken, redeemInvite } from '@/app-layer/usecases/tenant-invites';
import { withApiErrorHandling } from '@/lib/errors/api';
import { INVITE_REDEEM_LIMIT } from '@/lib/security/rate-limit';
import { enforceRateLimit, getClientIp, isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';
import { unauthorized } from '@/lib/errors/types';
import { jsonResponse } from '@/lib/api-response';

function applyRedeemRateLimit(req: NextRequest): NextResponse | null {
    if (isRateLimitBypassed()) return null;
    const enforcement = await enforceRateLimit(req, {
        scope: 'invite-redeem',
        config: INVITE_REDEEM_LIMIT,
        ip: getClientIp(req),
    });
    return enforcement.response ?? null;
}

export const GET = withApiErrorHandling(
    async (req: NextRequest, routeArgs: { params: Promise<{ token: string }> }) => {
        const limitResponse = applyRedeemRateLimit(req);
        if (limitResponse) return limitResponse;

        const { token } = await routeArgs.params;
        const session = await auth();
        const sessionEmail = session?.user?.email ?? null;

        const preview = await previewInviteByToken(token, sessionEmail);
        if (!preview) {
            // Return 410 Gone for expired/revoked/accepted; 404 for not-found.
            // We don't distinguish to avoid exposing token existence.
            return NextResponse.json(
                { error: { code: 'GONE', message: 'Invite is not valid or has expired.' } },
                { status: 410 },
            );
        }

        return jsonResponse({
            tenantName: preview.tenantName,
            tenantSlug: preview.tenantSlug,
            role: preview.role,
            expiresAt: preview.expiresAt.toISOString(),
            matchesSession: preview.matchesSession,
        });
    },
);

export const POST = withApiErrorHandling(
    async (req: NextRequest, routeArgs: { params: Promise<{ token: string }> }) => {
        const limitResponse = applyRedeemRateLimit(req);
        if (limitResponse) return limitResponse;

        const session = await auth();
        if (!session?.user?.id || !session.user.email) {
            throw unauthorized('You must be signed in to accept an invite.');
        }

        const { token } = await routeArgs.params;
        const result = await redeemInvite({
            token,
            userId: session.user.id,
            userEmail: session.user.email,
        });

        return jsonResponse({
            tenantId: result.tenantId,
            slug: result.slug,
            role: result.role,
        });
    },
);
