/**
 * Auth.js (NextAuth v4) configuration — single consolidated module.
 *
 * GAP-04 — migrated from `next-auth@5.0.0-beta.30` (where the auth
 * config was split into edge-safe `auth.config.ts` + node-only
 * `auth.ts`) to `next-auth@4.24.14` (stable). v4 doesn't need the
 * edge/node split because the middleware uses `getToken()` directly
 * rather than the v5 `auth()` async wrapper.
 *
 * Exports:
 *   - `authOptions` — the canonical config consumed by every server-
 *     side helper that needs the session (`getServerSession(authOptions)`)
 *     and by the catch-all route handler.
 *   - `auth` — back-compat alias for `() => getServerSession(authOptions)`
 *     so the migration doesn't churn the 15 server-component import
 *     sites in a single PR. The alias has the same return shape as
 *     v5's `auth()` (Session | null) but is sync-callable from server
 *     contexts. New code should call `getServerSession(authOptions)`
 *     directly.
 *
 * Architecture preserved from the v5-beta era:
 *   - JWT session strategy (no Session table writes).
 *   - PrismaAdapter for the Account-linking + User row lifecycle.
 *   - Three callbacks: signIn (account linking + invite redemption),
 *     jwt (MFA + session-tracking + token refresh + sessionVersion),
 *     session (selective field exposure to client).
 *   - Module augmentation in `next-auth` (Session.user) and
 *     `next-auth/jwt` (custom token fields) — eliminates the 8
 *     `as any` casts the v5-beta type drift required.
 */

import type { NextAuthOptions, Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
// GAP-04 — v5 renamed `azure-ad` → `microsoft-entra-id` to track
// Microsoft's product rename. v4 still ships under the original name.
// Same provider, same OAuth endpoints, same scopes.
import AzureAD from 'next-auth/providers/azure-ad';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import prisma from '@/lib/prisma';
import { env } from '@/env';
import { authenticateWithPassword } from '@/lib/auth/credentials';
import { isTokenExpired, refreshAccessToken } from '@/lib/auth/refresh';
import type { Role } from '@prisma/client';
import { edgeLogger } from '@/lib/observability/edge-logger';
import { hashForLookup } from '@/lib/security/encryption';

// ─── Type augmentation ──────────────────────────────────────────────
//
// GAP-04 — the v5-beta type instability that drove 8 `as any` casts
// across auth.ts/auth.config.ts/middleware.ts is resolved here by
// declaring both Session.user AND the JWT shape so middleware +
// server-component reads are typed end-to-end.

/**
 * Hard cap on how many membership entries are embedded in the JWT.
 *
 * A user in very many tenants/orgs would otherwise grow the session
 * cookie without bound — the JWT is a fixed-size credential, not a
 * data store. 50 is far above any realistic human workspace count, so
 * this is a safety valve rather than an everyday limit.
 *
 * When the real membership count exceeds this, the JWT carries the
 * first `MAX_JWT_MEMBERSHIPS` entries and `membershipsTruncated` /
 * `orgMembershipsTruncated` is set. The Edge middleware then defers a
 * slug-miss to the authoritative server-side gate (`TenantLayout` /
 * `getTenantCtx`, both DB-backed) instead of treating it as a
 * definitive cross-tenant denial. UI surfaces that need the COMPLETE
 * list (the `/tenants` picker) do their own server-side DB lookup.
 */
export const MAX_JWT_MEMBERSHIPS = 50;

/** One entry per active membership the user holds. */
export interface MembershipEntry {
    slug: string;
    role: Role;
    tenantId: string;
}

/**
 * One entry per active OrgMembership the user holds. Mirrors
 * `MembershipEntry` for the hub-and-spoke organization layer.
 * Threaded through the JWT so middleware can gate `/org/:slug/*`
 * routes against the user's org memberships in O(1) per request
 * with no DB hit — same pattern as the tenant access gate.
 */
export interface OrgMembershipEntry {
    slug: string;
    role: 'ORG_ADMIN' | 'ORG_READER';
    organizationId: string;
}

declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            email: string;
            name?: string | null;
            image?: string | null;
            tenantId?: string | null;
            role: Role;
            mfaPending?: boolean;
            /** R-1: all active memberships, for the tenant picker and middleware gate. */
            memberships?: MembershipEntry[];
            /** Org-layer memberships, for the org-route middleware gate. */
            orgMemberships?: OrgMembershipEntry[];
        };
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        userId?: string;
        sessionVersion?: number;
        sessionVersionCheckedAt?: number;
        tenantId?: string | null;
        tenantSlug?: string | null;
        role?: Role;
        mfaPending?: boolean;
        mfaFailClosed?: boolean;
        /** Active tenant memberships, capped at MAX_JWT_MEMBERSHIPS. */
        memberships?: MembershipEntry[];
        /** Active org memberships, capped at MAX_JWT_MEMBERSHIPS. */
        orgMemberships?: OrgMembershipEntry[];
        /** True when `memberships` is a capped subset of the real set. */
        membershipsTruncated?: boolean;
        /** True when `orgMemberships` is a capped subset of the real set. */
        orgMembershipsTruncated?: boolean;
        /** Provider name when the user signed in via OAuth. */
        provider?: string;
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        /** Operational session row id (Epic C.3). */
        userSessionId?: string;
        /** Soft-error flag — surfaces `RefreshTokenError` / `SessionRevoked` / `MfaDependencyFailure`. */
        error?: string;
    }
}

// ─── Providers ──────────────────────────────────────────────────────
//
// Edge-safe providers (Google, MicrosoftEntraID) used to live in a
// separate `auth.config.ts` because v5's middleware-side `auth()`
// wrapper bundled the full config into the Edge runtime. v4's
// middleware uses `getToken()` directly, which only verifies the JWT
// cookie — providers are never bundled into the Edge bundle. So the
// split is no longer required.

const providers: NextAuthOptions['providers'] = [
    Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        authorization: {
            params: {
                access_type: 'offline',
                prompt: 'consent',
                scope: 'openid email profile',
            },
        },
    }),
    AzureAD({
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
        tenantId: env.MICROSOFT_TENANT_ID,
        authorization: {
            params: {
                scope: 'openid email profile offline_access',
            },
        },
    }),
    // Credentials — production-grade email+password auth.
    //
    // The hardened path lives in `src/lib/auth/credentials.ts`
    // (account-enumeration-safe, timing-equalised, email-verification-
    // gate-ready, silent-rehash-on-verify). The provider is always
    // registered; whether the login UI shows the email/password *form*
    // is a separate decision made in `src/app/login/page.tsx` based on
    // `getProviders()`.
    Credentials({
        id: 'credentials',
        name: 'Email and password',
        credentials: {
            email: { label: 'Email', type: 'email' },
            password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
            const result = await authenticateWithPassword({
                email: (credentials?.email as string | undefined) ?? '',
                password: (credentials?.password as string | undefined) ?? '',
            });
            // NextAuth surfaces any non-null return as a successful sign-in
            // and dispatches the `signIn` + `jwt` callbacks. Returning null
            // collapses every failure reason into the same client-facing
            // `CredentialsSignin` error — the account-enumeration-safe shape.
            if (!result.ok) return null;
            return {
                id: result.userId,
                email: result.email,
                name: result.name,
            };
        },
    }),
];

// ─── Invite-redemption helpers ──────────────────────────────────────
//
// Sign-in alone grants AUTHENTICATION; tenant membership is created
// ONLY via redemption of a token-bound invite (Epic 1, GAP-01 closure).

async function ensureTenantMembershipFromInvite(
    userId: string,
    userEmail: string,
    inviteToken: string | null,
): Promise<void> {
    if (!inviteToken) return; // the common case
    try {
        const { redeemInvite } = await import('@/app-layer/usecases/tenant-invites');
        await redeemInvite({ token: inviteToken, userId, userEmail });
    } catch (err) {
        // Surface via logger; do NOT fail the sign-in. The user is
        // authenticated; they'll land on /no-tenant where they can
        // see a "this invite is invalid" hint on their next visit.
        edgeLogger.warn('signIn: invite redemption failed', {
            component: 'auth',
            userId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Epic D — same shape as ensureTenantMembershipFromInvite but for
 * org invites. Reads the `inflect_org_invite_token` cookie set by
 * /api/org/invite/:token/start-signin, then calls redeemOrgInvite.
 * Best-effort; a failure logs and falls through (the user is still
 * authenticated, they'll land on the appropriate "no access" page).
 */
async function ensureOrgMembershipFromInvite(
    userId: string,
    userEmail: string,
    orgInviteToken: string | null,
): Promise<void> {
    if (!orgInviteToken) return;
    try {
        const { redeemOrgInvite } = await import('@/app-layer/usecases/org-invites');
        await redeemOrgInvite({ token: orgInviteToken, userId, userEmail });
    } catch (err) {
        edgeLogger.warn('signIn: org invite redemption failed', {
            component: 'auth',
            userId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function readInviteTokenFromCookies(): Promise<{
    tenantToken: string | null;
    orgToken: string | null;
}> {
    try {
        // GAP-05 — Next 15 made `cookies()` async (Promise<ReadonlyCookies>).
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        return {
            tenantToken: cookieStore.get('inflect_invite_token')?.value ?? null,
            orgToken: cookieStore.get('inflect_org_invite_token')?.value ?? null,
        };
    } catch {
        return { tenantToken: null, orgToken: null };
    }
}

// ─── NextAuthOptions ────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
    providers,
    pages: {
        signIn: '/login',
        error: '/login',
    },
    session: { strategy: 'jwt' },
    secret: env.AUTH_SECRET,
    callbacks: {
        /**
         * signIn — runs on EVERY sign-in attempt. Two responsibilities:
         *
         *   1. Account linking: if the OAuth email matches a User row
         *      created by a different provider, link the new OAuth
         *      `Account` to the existing User rather than creating a
         *      duplicate.
         *
         *   2. Invite redemption: if an `inflect_invite_token` cookie
         *      (tenant invite) or `inflect_org_invite_token` cookie
         *      (org invite, Epic D) is present, redeem it to create
         *      the corresponding TenantMembership / OrgMembership.
         *
         * Sign-in alone grants AUTHENTICATION, not tenant or org
         * membership. There is NO auto-join behaviour — see
         * `tests/guardrails/no-auto-join.test.ts`.
         */
        async signIn({ user, account, profile }) {
            if (!account) return true;

            // R-3: defensive email-verified check for OAuth.
            if (
                account.provider !== 'credentials' &&
                profile &&
                'email_verified' in profile &&
                profile.email_verified === false
            ) {
                edgeLogger.warn('signIn rejected: provider reported email_verified=false', {
                    component: 'auth',
                    provider: account.provider,
                    email: user.email ?? undefined,
                });
                return false;
            }

            const inviteTokens = await readInviteTokenFromCookies();

            // 1. Account linking for OAuth (not credentials).
            if (account.provider !== 'credentials' && user.email) {
                const existingUser = await prisma.user.findUnique({
                    where: { emailHash: hashForLookup(user.email) },
                });

                if (existingUser && user.id !== existingUser.id) {
                    const existingAccount = await prisma.account.findUnique({
                        where: {
                            provider_providerAccountId: {
                                provider: account.provider,
                                providerAccountId: account.providerAccountId,
                            },
                        },
                    });

                    if (!existingAccount) {
                        await prisma.account.create({
                            data: {
                                userId: existingUser.id,
                                type: account.type,
                                provider: account.provider,
                                providerAccountId: account.providerAccountId,
                                refresh_token: (account.refresh_token as string) ?? null,
                                access_token: (account.access_token as string) ?? null,
                                expires_at: (account.expires_at as number) ?? null,
                                token_type: (account.token_type as string) ?? null,
                                scope: (account.scope as string) ?? null,
                                id_token: (account.id_token as string) ?? null,
                                session_state: (account.session_state as string) ?? null,
                            },
                        });
                    }
                    await ensureTenantMembershipFromInvite(
                        existingUser.id,
                        user.email,
                        inviteTokens.tenantToken,
                    );
                    await ensureOrgMembershipFromInvite(
                        existingUser.id,
                        user.email,
                        inviteTokens.orgToken,
                    );
                    return true;
                }
            }

            // 2. Invite redemption (no auto-join).
            if (user.id && user.email) {
                await ensureTenantMembershipFromInvite(
                    user.id,
                    user.email,
                    inviteTokens.tenantToken,
                );
                await ensureOrgMembershipFromInvite(
                    user.id,
                    user.email,
                    inviteTokens.orgToken,
                );
            }
            return true;
        },

        /**
         * jwt — enrich the token with custom fields, handle OAuth
         * token refresh, and gate MFA + sessionVersion + Epic C.3
         * session tracking.
         */
        async jwt({ token, user, account }) {
            // Initial sign in.
            if (account && user) {
                const dbUser = await prisma.user.findUnique({
                    where: { emailHash: hashForLookup(token.email!) },
                    include: {
                        tenantMemberships: {
                            where: { status: 'ACTIVE' },
                            orderBy: { createdAt: 'asc' },
                            include: {
                                tenant: { select: { slug: true, id: true } },
                            },
                        },
                        orgMemberships: {
                            orderBy: { createdAt: 'asc' },
                            include: {
                                organization: {
                                    select: { slug: true, id: true },
                                },
                            },
                        },
                    },
                });

                if (dbUser) {
                    token.userId = dbUser.id;
                    token.sessionVersion = dbUser.sessionVersion;

                    // Store the user's active memberships so the Edge
                    // middleware can authorize any slug they belong to
                    // with no DB hit. Capped at MAX_JWT_MEMBERSHIPS so the
                    // cookie stays bounded; `membershipsTruncated` flags
                    // the rare over-cap case for the middleware gate.
                    token.memberships = dbUser.tenantMemberships
                        .slice(0, MAX_JWT_MEMBERSHIPS)
                        .map((m) => ({
                            slug: m.tenant.slug,
                            role: m.role,
                            tenantId: m.tenantId,
                        }));
                    token.membershipsTruncated =
                        dbUser.tenantMemberships.length > MAX_JWT_MEMBERSHIPS;

                    // GAP O4-1: same pattern (and same cap) for the
                    // org-layer memberships so the middleware can gate
                    // `/org/:slug/*` with no DB hit.
                    token.orgMemberships = dbUser.orgMemberships
                        .slice(0, MAX_JWT_MEMBERSHIPS)
                        .map((m) => ({
                            slug: m.organization.slug,
                            role: m.role,
                            organizationId: m.organizationId,
                        }));
                    token.orgMembershipsTruncated =
                        dbUser.orgMemberships.length > MAX_JWT_MEMBERSHIPS;

                    // Backward-compat: keep tenantId/tenantSlug/role as the
                    // "primary" membership (oldest by createdAt).
                    const primary = token.memberships[0];
                    if (primary) {
                        token.tenantId = primary.tenantId;
                        token.tenantSlug = primary.slug;
                        token.role = primary.role;
                    } else {
                        token.tenantId = null;
                        token.tenantSlug = null;
                        token.role = 'READER';
                    }
                } else {
                    token.userId = user.id;
                    token.role = 'READER';
                    token.sessionVersion = 0;
                    token.memberships = [];
                    token.orgMemberships = [];
                    token.membershipsTruncated = false;
                    token.orgMembershipsTruncated = false;
                }

                if (account.provider !== 'credentials') {
                    token.provider = account.provider;
                    token.accessToken = (account.access_token as string) ?? undefined;
                    token.refreshToken = (account.refresh_token as string) ?? undefined;
                    token.expiresAt = (account.expires_at as number) ?? undefined;
                }

                // ── MFA enforcement ──
                token.mfaPending = false;
                const activeTenantId = token.tenantId ?? null;
                if (activeTenantId) {
                    try {
                        const secSettings = await prisma.tenantSecuritySettings.findUnique({
                            where: { tenantId: activeTenantId },
                        });
                        const policy = secSettings?.mfaPolicy ?? 'DISABLED';
                        const failClosed = secSettings?.mfaFailClosed ?? false;
                        token.mfaFailClosed = failClosed;

                        if (policy === 'REQUIRED' || policy === 'OPTIONAL') {
                            const enrollment = await prisma.userMfaEnrollment.findUnique({
                                where: {
                                    userId_tenantId_type: {
                                        userId: token.userId!,
                                        tenantId: activeTenantId,
                                        type: 'TOTP',
                                    },
                                },
                            });

                            if (policy === 'REQUIRED') {
                                token.mfaPending = true;
                            } else if (policy === 'OPTIONAL' && enrollment?.isVerified) {
                                token.mfaPending = true;
                            }
                        }
                    } catch {
                        if (token.mfaFailClosed) {
                            token.mfaPending = true;
                            token.error = 'MfaDependencyFailure';
                        }
                    }
                }

                // ── Epic C.3 — record operational session row ──
                try {
                    const { recordNewSession } = await import(
                        '@/lib/security/session-tracker'
                    );
                    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                    const recorded = await recordNewSession({
                        userId: token.userId!,
                        tenantId: token.tenantId ?? null,
                        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
                    });
                    token.userSessionId = recorded.sessionId;
                } catch {
                    // Already swallowed in the helper.
                }

                return token;
            }

            // ── Subsequent requests ──

            // Epic C.3 — verify session row still exists + isn't revoked.
            if (typeof token.userSessionId === 'string' && token.userSessionId) {
                try {
                    const { verifyAndTouchSession } = await import(
                        '@/lib/security/session-tracker'
                    );
                    const result = await verifyAndTouchSession(
                        token.userSessionId,
                    );
                    if (result.revoked) {
                        return { ...token, error: 'SessionRevoked' };
                    }
                } catch {
                    // Helper already logs; fail-open on telemetry-side
                    // failures so a transient DB blip doesn't sign every
                    // user out.
                }
            }

            // OAuth token refresh.
            if (
                token.provider &&
                token.expiresAt &&
                token.refreshToken &&
                isTokenExpired(token.expiresAt)
            ) {
                try {
                    const refreshed = await refreshAccessToken(
                        token.provider,
                        token.refreshToken,
                    );

                    token.accessToken = refreshed.accessToken;
                    token.expiresAt = refreshed.expiresAt;
                    if (refreshed.refreshToken) {
                        token.refreshToken = refreshed.refreshToken;
                    }
                    delete token.error;

                    await prisma.account.updateMany({
                        where: {
                            userId: token.userId!,
                            provider: token.provider,
                        },
                        data: {
                            access_token: refreshed.accessToken,
                            expires_at: refreshed.expiresAt,
                            ...(refreshed.refreshToken
                                ? { refresh_token: refreshed.refreshToken }
                                : {}),
                        },
                    });
                } catch {
                    edgeLogger.error('Token refresh failed, forcing reauth', { component: 'auth' });
                    token.error = 'RefreshTokenError';
                }
            }

            // MFA challenge completion check.
            if (token.mfaPending === true && token.userId && token.tenantId) {
                try {
                    const enrollment = await prisma.userMfaEnrollment.findUnique({
                        where: {
                            userId_tenantId_type: {
                                userId: token.userId,
                                tenantId: token.tenantId,
                                type: 'TOTP',
                            },
                        },
                        select: { lastChallengeAt: true, isVerified: true },
                    });

                    if (enrollment?.lastChallengeAt) {
                        const tokenIat = (token.iat as number | undefined) ?? 0;
                        const challengeTime = Math.floor(enrollment.lastChallengeAt.getTime() / 1000);
                        if (challengeTime >= tokenIat) {
                            token.mfaPending = false;
                        }
                    }
                } catch {
                    if (token.mfaFailClosed) {
                        token.error = 'MfaDependencyFailure';
                    } else {
                        token.mfaPending = false;
                    }
                }
            }

            // Throttled sessionVersion check (5-minute interval).
            if (typeof token.sessionVersion === 'number' && token.userId) {
                const SESSION_CHECK_INTERVAL = 300; // seconds
                const now = Math.floor(Date.now() / 1000);
                const lastChecked = token.sessionVersionCheckedAt ?? 0;
                if (now - lastChecked >= SESSION_CHECK_INTERVAL) {
                    try {
                        const currentUser = await prisma.user.findUnique({
                            where: { id: token.userId },
                            select: { sessionVersion: true },
                        });
                        if (currentUser && currentUser.sessionVersion > token.sessionVersion) {
                            return { ...token, error: 'SessionRevoked' };
                        }
                        token.sessionVersionCheckedAt = now;
                    } catch {
                        // Fail open on telemetry-side failures.
                    }
                }
            }

            return token;
        },

        /**
         * session — expose ONLY safe fields to the client.
         * NEVER include accessToken or refreshToken.
         */
        async session({ session, token }) {
            if (token) {
                session.user.id = token.userId ?? token.sub!;
                session.user.tenantId = token.tenantId ?? null;
                session.user.role = token.role ?? 'READER';
                session.user.mfaPending = token.mfaPending ?? false;
                session.user.memberships = token.memberships ?? [];
                session.user.orgMemberships = token.orgMemberships ?? [];
            }
            return session;
        },
    },
};

// ─── Server-side session helper ─────────────────────────────────────
//
// Back-compat alias for v5's `auth()` so the 15+ server-component
// import sites don't all need to update in this PR. The name + return
// shape match v5: `Session | null`. Internally it calls v4's
// `getServerSession(authOptions)`.
//
// New code should call `getServerSession(authOptions)` directly to
// make the dependency explicit at each call site.

export async function auth(): Promise<Session | null> {
    return getServerSession(authOptions);
}

// Re-export `getServerSession` for ergonomics.
export { getServerSession };

// ─── Server-side signOut shim ───────────────────────────────────────
//
// v5 exported a server-side `signOut()` from the NextAuth() return.
// v4 does not — sign-out is a client-side `next-auth/react` flow OR a
// direct DELETE of the session cookie. The two server components that
// call `signOut()` (no-tenant page, tenant-picker page) use it to log
// the user out before showing a "you don't have access" UI. We
// preserve that behavior by providing a thin server-side helper that
// redirects to the canonical NextAuth signout page.
//
// Returns a redirect Response that the page should `return`.
export async function signOut(options?: {
    redirectTo?: string;
}): Promise<void> {
    const { redirect } = await import('next/navigation');
    const target = options?.redirectTo ?? '/login';
    // NextAuth's signout endpoint clears the cookie and then redirects
    // to `callbackUrl`. Hitting it from a server component this way
    // matches the v5 behavior — the user lands at `target` with no
    // active session. `redirect()` throws and never returns.
    redirect(`/api/auth/signout?callbackUrl=${encodeURIComponent(target)}`);
}
