/**
 * Post-sign-in invite redemption.
 *
 * Redeems a pending tenant / org invite for a user who has JUST signed in,
 * resolving the PERSISTED `User.id` by email rather than trusting a
 * caller-supplied id.
 *
 * Why resolve by email:
 *
 *   In the NextAuth `signIn` callback a FIRST-TIME OAuth user's `user.id`
 *   is the identity-provider subject (Google `sub`, …), NOT our `User.id`
 *   — the Prisma adapter creates the row only AFTER `signIn` returns. The
 *   previous code redeemed there with that subject, so the membership
 *   upsert wrote against a non-existent `User` FK: the write threw, the
 *   error was swallowed (sign-in must not fail on a redemption problem),
 *   the invite was already burnt (`acceptedAt` committed in step 1 of
 *   `redeemInvite`), and the brand-new invitee landed on `/no-tenant` with
 *   a dead link. Returning invitees dodged it only because the signIn
 *   account-linking branch happened to resolve their real id.
 *
 *   Running from the `jwt` callback (which fires AFTER the adapter has
 *   created the row) and resolving the id by email fixes it uniformly for
 *   OAuth and credentials sign-ins alike.
 *
 * Best-effort: never throws. A failure logs and leaves the user
 * authenticated — they can be re-invited. This preserves the swallow
 * semantics the redemption has always had at the sign-in boundary.
 */
import prisma from '@/lib/prisma';
import { hashForLookup } from '@/lib/security/encryption';
import { edgeLogger } from '@/lib/observability/edge-logger';

export interface RedeemPendingInvitesInput {
    /** The signed-in user's email — the binding key for the invite. */
    userEmail: string;
    /** Raw tenant-invite token from the `inflect_invite_token` cookie, or null. */
    tenantToken: string | null;
    /** Raw org-invite token from the `inflect_org_invite_token` cookie, or null. */
    orgToken: string | null;
}

/**
 * Redeem whichever invite tokens are present, against the persisted user
 * resolved by `userEmail`. No-op when neither token is present or no user
 * row exists yet. Each redemption is independently best-effort.
 */
export async function redeemPendingInvites(
    input: RedeemPendingInvitesInput,
): Promise<void> {
    const { userEmail, tenantToken, orgToken } = input;
    if (!tenantToken && !orgToken) return; // the common case — no invite in flight

    // Resolve the PERSISTED user id by email. From the jwt callback this
    // row always exists (created by the adapter before jwt runs), even for
    // a first-time OAuth user whose signIn-callback `user.id` was the
    // provider subject.
    const dbUser = await prisma.user.findUnique({
        where: { emailHash: hashForLookup(userEmail) },
        select: { id: true },
    });
    if (!dbUser) return;

    if (tenantToken) {
        try {
            const { redeemInvite } = await import('@/app-layer/usecases/tenant-invites');
            await redeemInvite({ token: tenantToken, userId: dbUser.id, userEmail });
        } catch (err) {
            edgeLogger.warn('signIn: tenant invite redemption failed', {
                component: 'auth',
                userId: dbUser.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    if (orgToken) {
        try {
            const { redeemOrgInvite } = await import('@/app-layer/usecases/org-invites');
            await redeemOrgInvite({ token: orgToken, userId: dbUser.id, userEmail });
        } catch (err) {
            edgeLogger.warn('signIn: org invite redemption failed', {
                component: 'auth',
                userId: dbUser.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
