/**
 * Epic D — /invite/org/[token]
 *
 * Org-invite acceptance page. Mirrors /invite/[token] for tenant
 * invites:
 *   - Server-rendered preview via previewOrgInviteByToken.
 *   - If valid + signed in as matching email: direct accept form.
 *   - If valid + not signed in: "Sign in to accept" link → start-signin.
 *   - If valid + email mismatch: prompt to switch accounts.
 *   - If invalid/expired/revoked: friendly single-shape error.
 *
 * Submission uses POST `/api/org/invite/<token>/accept-redirect` so
 * the browser follows the 303 to /org/<slug> on success or back to
 * this page with an `?error=` query on failure.
 */
import { auth } from '@/auth';
import { previewOrgInviteByToken } from '@/app-layer/usecases/org-invites';
import { formatDateLong } from '@/lib/format-date';

interface InvitePageProps {
    params: Promise<{ token: string }>;
    searchParams: Promise<{ error?: string }>;
}

const ROLE_LABEL: Record<string, string> = {
    ORG_ADMIN: 'Org admin',
    ORG_READER: 'Org reader',
};

export default async function OrgInvitePage({ params, searchParams }: InvitePageProps) {
    const { token } = await params;
    const { error: errorParam } = await searchParams;
    const session = await auth();
    const sessionEmail = session?.user?.email ?? null;

    const preview = await previewOrgInviteByToken(token, sessionEmail);

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

    const roleLabel = ROLE_LABEL[preview.role] ?? preview.role;
    const expiryLabel = formatDateLong(preview.expiresAt);
    const isReady = session && preview.matchesSession;
    const loginUrl = `/api/org/invite/${token}/start-signin`;

    return (
        <main className="min-h-screen bg-bg-default flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-bg-surface rounded-lg border border-border-subtle p-8">
                <h1 className="text-2xl font-semibold text-content-default mb-2 text-center">
                    You have been invited
                </h1>
                <p className="text-content-muted text-center mb-6">
                    Join the{' '}
                    <span className="font-semibold text-content-default">
                        {preview.organizationName}
                    </span>{' '}
                    organization as a{' '}
                    <span className="font-semibold text-content-default">{roleLabel}</span>.
                </p>
                <p className="text-xs text-content-muted text-center mb-6">
                    Expires {expiryLabel}
                </p>

                {errorParam && (
                    <div
                        className="mb-4 rounded-md bg-bg-error border border-border-error p-3 text-sm text-content-error text-center"
                        role="alert"
                        data-testid="org-invite-error"
                    >
                        {errorParam}
                    </div>
                )}

                {isReady ? (
                    <OrgInviteAcceptForm token={token} />
                ) : (
                    <a
                        href={loginUrl}
                        className="block w-full text-center rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                        data-testid="org-invite-signin-cta"
                    >
                        Sign in to accept
                    </a>
                )}

                {session && !preview.matchesSession && (
                    <p className="mt-4 text-xs text-content-muted text-center">
                        You are signed in as{' '}
                        <span className="font-medium">{session.user?.email}</span>,
                        but this invite was sent to a different email address.
                        Sign in with the correct account to accept it.
                    </p>
                )}
            </div>
        </main>
    );
}

function OrgInviteAcceptForm({ token }: { token: string }) {
    return (
        <form action={`/api/org/invite/${token}/accept-redirect`} method="POST">
            <button
                type="submit"
                className="w-full rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                data-testid="org-invite-accept"
            >
                Accept invitation
            </button>
        </form>
    );
}
