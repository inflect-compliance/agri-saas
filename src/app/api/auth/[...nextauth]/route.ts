import type { NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authOptions } from '@/auth';
import {
    enforceRateLimit,
    isRateLimitBypassed,
    LOGIN_LIMIT,
} from '@/lib/security/rate-limit-middleware';

/** NextAuth handlers are request-dependent — never statically generate. */
export const dynamic = 'force-dynamic';

// GAP-04 + GAP-05 — v4 returns a single handler function that expects
// `(req, { params: { nextauth: string[] } })` for App Router catch-all
// routes. Under Next 15 the framework now passes `params` as a Promise
// (`Promise<{ nextauth: string[] }>`); NextAuth v4's internals
// destructure `params.nextauth` synchronously and crash with
// `Cannot destructure property 'nextauth' of 'a.query' as it is
// undefined` when handed the Promise.
//
// We pre-resolve the Promise here and pass the sync object to the v4
// handler. This is the canonical Next 15 + v4 compat pattern and
// preserves the LOGIN_LIMIT rate-limit wrap on POST.
const handler = NextAuth(authOptions);

type RouteContext = { params: Promise<{ nextauth: string[] }> };

// GET is for CSRF tokens, provider list, and session reads — not a
// brute-forceable surface, so no rate limit.
export async function GET(req: NextRequest, ctx: RouteContext) {
    const params = await ctx.params;
    return handler(req, { params });
}

/**
 * POST carries every sign-in / sign-out / callback flow. This is the
 * primary online-brute-force surface for credentials login.
 *
 * We apply LOGIN_LIMIT (10 attempts / 15 min, 15 min lockout) BEFORE
 * delegating to NextAuth. Keying is IP-only here because:
 *   - On credentials sign-in, NextAuth reads the username from the
 *     request body, but we don't parse the body at the rate-limit
 *     layer (body consumption would break NextAuth's own parser).
 *   - IP-only means a single IP credential-spraying many usernames
 *     still gets rate-limited — which is the primary threat.
 *
 * The edge-runtime `authRateLimit` path in src/middleware.ts provides
 * a coarser pre-auth gate; this Node-runtime check is the second
 * layer and the one that actually shares the in-memory counter with
 * the rest of the rate-limited API surface.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
    if (!isRateLimitBypassed()) {
        const { response } = await enforceRateLimit(req, {
            scope: 'login',
            config: LOGIN_LIMIT,
        });
        if (response) return response;
    }

    const params = await ctx.params;
    return handler(req, { params });
}
