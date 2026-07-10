/**
 * /api/invites/:token/accept-redirect
 *
 * GET — redeem the invite and redirect to /t/<slug>/dashboard.
 *
 * Used as the `callbackUrl` after sign-in from /invite/[token]:
 *   /login?callbackUrl=/api/invites/<token>/accept-redirect
 *
 * On success the user is redirected to their new tenant dashboard.
 * On failure (expired, wrong email, etc.) they are redirected to
 * /invite/<token>?error=<reason> so the invite page can surface the message.
 *
 * Sign-in required. Any tenant (no tenant permission middleware applies).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { resolvePublicOrigin } from '@/lib/http/request-origin';
import { redeemInvite } from '@/app-layer/usecases/tenant-invites';
import { INVITE_REDEEM_LIMIT } from '@/lib/security/rate-limit';
import { enforceRateLimit, getClientIp, isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';

export async function GET(
    req: NextRequest,
    routeArgs: { params: Promise<{ token: string }> },
) {
    if (!isRateLimitBypassed()) {
        const enforcement = await enforceRateLimit(req, {
            scope: 'invite-redeem',
            config: INVITE_REDEEM_LIMIT,
            ip: getClientIp(req),
        });
        if (enforcement.response) return enforcement.response;
    }

    const { token } = await routeArgs.params;
    const origin = resolvePublicOrigin(req);
    const session = await auth();

    if (!session?.user?.id || !session.user.email) {
        // Not signed in — send back to sign-in with this route as callbackUrl.
        const loginUrl = new URL('/login', origin);
        loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
        return NextResponse.redirect(loginUrl);
    }

    try {
        const result = await redeemInvite({
            token,
            userId: session.user.id,
            userEmail: session.user.email,
        });
        const dashUrl = new URL(`/t/${result.slug}/dashboard`, origin);
        return NextResponse.redirect(dashUrl);
    } catch (err) {
        const inviteUrl = new URL(`/invite/${token}`, origin);
        // Surface a human-readable error without leaking internals.
        const isAppError =
            typeof err === 'object' &&
            err !== null &&
            'status' in err &&
            'message' in err;
        if (isAppError) {
            inviteUrl.searchParams.set('error', String((err as { message: string }).message));
        } else {
            inviteUrl.searchParams.set('error', 'Could not accept invite. Please try again.');
        }
        return NextResponse.redirect(inviteUrl);
    }
}
