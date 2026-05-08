/**
 * /invite/[token] — Invite preview page.
 *
 * Server component. Calls previewInviteByToken, then renders:
 *   - If valid + signed in as matching email: direct "Accept" button.
 *   - If valid + not matching / not signed in: "Sign in to accept" link.
 *   - If expired/revoked/not-found: friendly error message.
 *
 * PR 4 will wire middleware redirects that land users here after sign-in
 * when their JWT carry an invite token. This page is the canonical place
 * for invite UX — do not inline invite acceptance anywhere else.
 */
import { auth } from '@/auth';
import { previewInviteByToken } from '@/app-layer/usecases/tenant-invites';
import { formatDateLong } from '@/lib/format-date';

interface InvitePageProps {
    params: Promise<{ token: string }>;
    searchParams: Promise<{ error?: string }>;
}

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
    const { token } = await params;
    const { error: errorParam } = await searchParams;
    const session = await auth();
    const sessionEmail = session?.user?.email ?? null;

    const preview = await previewInviteByToken(token, sessionEmail);

    if (!preview) {
        return (
            <main className="min-h-screen bg-bg-default flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-bg-surface rounded-lg border border-border-subtle p-8 text-center">
                    <div className="text-4xl mb-4">&#x26A0;&#xFE0F;</div>
                    <h1 className="text-xl font-semibold text-content-default mb-2">
                        Invite not available
                    </h1>
                    <p className="text-content-muted">
                        This invite link has expired, been revoked, or already been used.
                        Ask your admin to send a new invite.
                    </p>
                </div>
            </main>
        );
    }

    const roleLabel = preview.role.charAt(0) + preview.role.slice(1).toLowerCase();
    const expiryLabel = formatDateLong(preview.expiresAt);

    // If the user is signed in as the invitee, show the direct accept button.
    // The POST goes to /api/invites/:token which calls redeemInvite and
    // returns JSON; a thin client form handles the redirect.
    const isReady = session && preview.matchesSession;

    // start-signin sets the inflect_invite_token cookie then redirects to /login.
    // After OAuth the signIn callback reads the cookie and calls redeemInvite.
    const loginUrl = `/api/invites/${token}/start-signin`;

    return (
        <main className="min-h-screen bg-bg-default flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-bg-surface rounded-lg border border-border-subtle p-8">
                <h1 className="text-2xl font-semibold text-content-default mb-2 text-center">
                    You have been invited
                </h1>
                <p className="text-content-muted text-center mb-6">
                    Join <span className="font-semibold text-content-default">{preview.tenantName}</span>{' '}
                    as a{' '}
                    <span className="font-semibold text-content-default">{roleLabel}</span>.
                </p>
                <p className="text-xs text-content-muted text-center mb-6">
                    Expires {expiryLabel}
                </p>

                {errorParam && (
                    <div className="mb-4 rounded-md bg-bg-error border border-border-error p-3 text-sm text-content-error text-center">
                        {errorParam}
                    </div>
                )}

                {isReady ? (
                    <InviteAcceptForm token={token} />
                ) : (
                    <a
                        href={loginUrl}
                        className="block w-full text-center rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                    >
                        Sign in to accept
                    </a>
                )}

                {session && !preview.matchesSession && (
                    <p className="mt-4 text-xs text-content-muted text-center">
                        You are signed in as <span className="font-medium">{session.user?.email}</span>,
                        but this invite was sent to a different email address.
                        Sign in with the correct account to accept it.
                    </p>
                )}
            </div>
        </main>
    );
}

/**
 * Thin client component that POSTs to the redeem endpoint and redirects.
 * Kept minimal — no heavy UI library imports needed.
 */
function InviteAcceptForm({ token }: { token: string }) {
    return (
        <form
            action={`/api/invites/${token}`}
            method="POST"
            onSubmit={undefined}
        >
            <button
                type="submit"
                className="w-full rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
                Accept invitation
            </button>
        </form>
    );
}
