import { formatDate } from '@/lib/format-date';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { resolveTenantContext } from '@/lib/tenant-context';
import prisma from '@/lib/prisma';
import { BillingActions } from './BillingActions';
import { BillingEventLog } from './BillingEventLog';
import { getBillingMode } from '@/lib/billing/entitlements';

export const dynamic = 'force-dynamic';

/**
 * Admin-only billing overview page.
 * Shows current plan, status, renewal date, trial info, upgrade/manage actions, and event history.
 */
export default async function BillingPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;

    const session = await auth();
    if (!session?.user?.id) notFound();

    let tenantCtx;
    try {
        tenantCtx = await resolveTenantContext({ tenantSlug }, session.user.id);
    } catch {
        notFound();
    }



    // Fetch billing account
    const billingAccount = await prisma.billingAccount.findUnique({
        where: { tenantId: tenantCtx.tenant.id },
    });

    const billingMode = getBillingMode();
    const plan = billingAccount?.plan ?? 'FREE';
    const status = billingAccount?.status ?? 'ACTIVE';
    const periodEnd = billingAccount?.currentPeriodEnd;
    const trialEnd = billingAccount?.trialEndsAt;
    const hasSubscription = !!billingAccount?.stripeSubscriptionId;
    const isTrialing = status === 'TRIALING' && trialEnd;

    // Compute trial days remaining
    let trialDaysRemaining: number | null = null;
    if (isTrialing && trialEnd) {
        // Server component — Date.now() runs once per request server-side,
        // not in a React render cycle. Lint can't distinguish server from client.
        // eslint-disable-next-line react-hooks/purity
        const diffMs = new Date(trialEnd).getTime() - Date.now();
        trialDaysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    // Fetch recent billing events
    const recentEvents = await prisma.billingEvent.findMany({
        where: { tenantId: tenantCtx.tenant.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
            id: true,
            type: true,
            stripeEventId: true,
            createdAt: true,
        },
    });

    return (
        <div className="space-y-8 animate-fadeIn">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold">Billing</h1>
                <p className="text-sm text-content-muted mt-1">
                    Manage your workspace plan and billing for <span className="text-content-emphasis font-medium">{tenantCtx.tenant.name}</span>.
                </p>
            </div>

            {/* Trial banner */}
            {isTrialing && trialDaysRemaining !== null && (
                <div className={`glass-card p-4 border ${
                    trialDaysRemaining <= 3 ? 'border-border-error bg-bg-error' : 'border-border-warning bg-bg-warning'
                }`} id="trial-banner">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className={`text-sm font-semibold ${trialDaysRemaining <= 3 ? 'text-content-error' : 'text-content-warning'}`}>
                                {trialDaysRemaining === 0
                                    ? 'Your trial expires today!'
                                    : `${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} left in your trial`}
                            </p>
                            <p className="text-xs text-content-muted mt-0.5">
                                Trial ends on {formatDate(trialEnd)}. Upgrade to keep access to premium features.
                            </p>
                        </div>
                        {billingMode === 'SAAS' && (
                            <BillingActions plan="PRO" tenantSlug={tenantSlug} />
                        )}
                    </div>
                </div>
            )}

            {/* Current Plan Card */}
            <section className="glass-card p-6">
                <h2 className="text-lg font-semibold mb-4">Current Plan</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <p className="text-xs text-content-subtle uppercase tracking-wider mb-1">Plan</p>
                        <span className={`badge ${
                            plan === 'ENTERPRISE' ? 'badge-warning' :
                            plan === 'PRO' ? 'badge-info' :
                            plan === 'TRIAL' ? 'badge-neutral' :
                            'badge-neutral'
                        } text-sm`}>
                            {plan}
                        </span>
                    </div>
                    <div>
                        <p className="text-xs text-content-subtle uppercase tracking-wider mb-1">Status</p>
                        <span className={`badge ${
                            status === 'ACTIVE' ? 'badge-info' :
                            status === 'TRIALING' ? 'badge-warning' :
                            status === 'PAST_DUE' ? 'badge-danger' :
                            status === 'CANCELED' ? 'badge-danger' :
                            'badge-neutral'
                        } text-sm`}>
                            {status.replace('_', ' ')}
                        </span>
                    </div>
                    <div>
                        <p className="text-xs text-content-subtle uppercase tracking-wider mb-1">Renewal</p>
                        <p className="text-sm text-content-emphasis">
                            {periodEnd ? formatDate(periodEnd) : '—'}
                        </p>
                    </div>
                    <div>
                        <p className="text-xs text-content-subtle uppercase tracking-wider mb-1">Trial Ends</p>
                        <p className="text-sm text-content-emphasis">
                            {trialEnd ? (
                                <>
                                    {formatDate(trialEnd)}
                                    {trialDaysRemaining !== null && (
                                        <span className={`ml-1 text-xs ${trialDaysRemaining <= 3 ? 'text-content-error' : 'text-content-warning'}`}>
                                            ({trialDaysRemaining}d left)
                                        </span>
                                    )}
                                </>
                            ) : '—'}
                        </p>
                    </div>
                </div>

                {/* Past due warning */}
                {status === 'PAST_DUE' && (
                    <div className="mt-4 p-3 bg-bg-error border border-border-error rounded-lg">
                        <p className="text-sm text-content-error font-medium">Payment issue detected</p>
                        <p className="text-xs text-content-muted mt-1">Please update your payment method to avoid service interruption.</p>
                    </div>
                )}
            </section>

            {/* Self-hosted banner — billing UI is decorative in this mode.
                Stripe is not configured (STRIPE_SECRET_KEY unset), so plan
                limits resolve to ENTERPRISE for every tenant and the
                Stripe-backed buttons would 403 with "billing_unavailable". */}
            {billingMode === 'SELFHOSTED' && (
                <div
                    className="glass-card p-4 border border-border-warning bg-bg-warning"
                    id="billing-self-hosted-banner"
                >
                    <p className="text-sm font-semibold text-content-warning">
                        Self-hosted deployment
                    </p>
                    <p className="text-xs text-content-muted mt-1">
                        This instance runs without a Stripe integration —
                        plan limits resolve to ENTERPRISE for every tenant
                        and the in-app upgrade / portal buttons are disabled.
                        Subscription changes are managed by your operator.
                    </p>
                </div>
            )}

            {/* Upgrade Options */}
            {billingMode === 'SAAS' && (plan === 'FREE' || plan === 'TRIAL') && (
                <section>
                    <h2 className="text-lg font-semibold mb-4">Upgrade</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="glass-card p-6 border border-[var(--brand-default)]/30 hover:border-[var(--brand-default)]/60 transition">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-content-emphasis font-semibold">Pro</h3>
                                <span className="badge badge-info">Recommended</span>
                            </div>
                            <ul className="text-sm text-content-muted space-y-1 mb-4">
                                <li>Unlimited controls & policies</li>
                                <li>Advanced reporting</li>
                                <li>Audit readiness features</li>
                                <li>Priority support</li>
                            </ul>
                            <BillingActions plan="PRO" tenantSlug={tenantSlug} />
                        </div>
                        <div className="glass-card p-6 border border-purple-500/30 hover:border-purple-500/60 transition">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-content-emphasis font-semibold">Enterprise</h3>
                                <span className="badge badge-warning">Premium</span>
                            </div>
                            <ul className="text-sm text-content-muted space-y-1 mb-4">
                                <li>Everything in Pro</li>
                                <li>SSO & advanced security</li>
                                <li>Custom integrations</li>
                                <li>Dedicated account manager</li>
                            </ul>
                            <BillingActions plan="ENTERPRISE" tenantSlug={tenantSlug} />
                        </div>
                    </div>
                </section>
            )}

            {/* Manage Subscription */}
            {billingMode === 'SAAS' && hasSubscription && (
                <section>
                    <h2 className="text-lg font-semibold mb-4">Manage Subscription</h2>
                    <div className="glass-card p-6">
                        <p className="text-sm text-content-muted mb-4">
                            Update payment method, view invoices, or change your plan via the Stripe Customer Portal.
                        </p>
                        <BillingActions portal tenantSlug={tenantSlug} />
                    </div>
                </section>
            )}

            {/* Billing Event History */}
            <section>
                <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
                <BillingEventLog
                    events={recentEvents.map(e => ({
                        id: e.id,
                        type: e.type,
                        stripeEventId: e.stripeEventId,
                        createdAt: e.createdAt.toISOString(),
                    }))}
                />
            </section>
        </div>
    );
}
