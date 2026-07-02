import { getTranslations } from 'next-intl/server';
import { Shield, CreditCard, KeyRound, ShieldCheck, ShieldPlus, Users, UserCog, CloudCog, Plug, Palette, Gauge, Bell, ScrollText, ToggleLeft, Tractor } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { PageHeader } from '@/components/layout/PageHeader';

export const dynamic = 'force-dynamic';

/**
 * Admin landing — pure pill-nav surface.
 *
 * R13-PR10 retired the embedded audit log tab and the policy
 * templates tab. Audit log now lives at its own page
 * (`/admin/audit-log`) reachable via the pill next to
 * Notifications. Policy templates were unused chrome and were
 * dropped entirely.
 */
export default async function AdminPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;

    const t = await getTranslations('admin');

    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;

    return (
        <div className="space-y-section animate-fadeIn">
            <PageHeader
                breadcrumbs={[
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: t('title') },
                ]}
                title={t('title')}
                actions={
                    <div
                        className="flex items-center gap-compact rounded-lg border border-border-subtle bg-bg-default px-3 py-1.5"
                        id="admin-theme-section"
                    >
                        <Palette className="w-4 h-4 text-content-muted" />
                        <span className="text-sm text-content-muted">Theme</span>
                        <ThemeToggle id="admin-theme-toggle" />
                    </div>
                }
            />

            {/* Navigation pills — pure server-rendered links. */}
            <div className="flex gap-tight flex-wrap">
                <Link
                    href={tenantHref('/admin/members')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="members-pill-btn"
                >
                    <Users className="w-3.5 h-3.5" />
                    Members &amp; Roles
                </Link>
                <Link
                    href={tenantHref('/admin/rbac')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="rbac-pill-btn"
                >
                    <Shield className="w-3.5 h-3.5" />
                    Roles &amp; Access
                </Link>
                <Link
                    href={tenantHref('/admin/roles')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="custom-roles-pill-btn"
                >
                    <ShieldPlus className="w-3.5 h-3.5" />
                    Custom Roles
                </Link>
                <Link
                    href={tenantHref('/admin/api-keys')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="api-keys-pill-btn"
                >
                    <KeyRound className="w-3.5 h-3.5" />
                    API Keys
                </Link>
                <Link
                    href={tenantHref('/admin/billing')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="billing-pill-btn"
                >
                    <CreditCard className="w-3.5 h-3.5" />
                    Billing
                </Link>
                <Link
                    href={tenantHref('/admin/sso')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="sso-pill-btn"
                >
                    <KeyRound className="w-3.5 h-3.5" />
                    SSO &amp; Identity
                </Link>
                <Link
                    href={tenantHref('/admin/scim')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="scim-pill-btn"
                >
                    <CloudCog className="w-3.5 h-3.5" />
                    SCIM Provisioning
                </Link>
                <Link
                    href={tenantHref('/admin/entra')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="entra-pill-btn"
                >
                    <UserCog className="w-3.5 h-3.5" />
                    Entra Access Mapping
                </Link>
                <Link
                    href={tenantHref('/admin/integrations')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="integrations-pill-btn"
                >
                    <Plug className="w-3.5 h-3.5" />
                    Integrations
                </Link>
                <Link
                    href={tenantHref('/admin/modules')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="modules-pill-btn"
                >
                    <ToggleLeft className="w-3.5 h-3.5" />
                    Modules
                </Link>
                <Link
                    href={tenantHref('/admin/farm-profile')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="farm-profile-pill-btn"
                >
                    <Tractor className="w-3.5 h-3.5" />
                    Farm profile
                </Link>
                <Link
                    href={tenantHref('/admin/security')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="security-pill-btn"
                >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Security &amp; MFA
                </Link>
                <Link
                    href={tenantHref('/admin/risk-appetite')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="risk-appetite-pill-btn"
                >
                    <Gauge className="w-3.5 h-3.5" />
                    Risk Appetite
                </Link>
                <Link
                    href={tenantHref('/admin/notifications')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="notifications-pill-btn"
                >
                    <Bell className="w-3.5 h-3.5" />
                    Notifications
                </Link>
                <Link
                    href={tenantHref('/admin/ledger-integrity')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="ledger-integrity-pill-btn"
                >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Ledger Integrity
                </Link>
                <Link
                    href={tenantHref('/admin/audit-log')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="audit-log-pill-btn"
                >
                    <ScrollText className="w-3.5 h-3.5" />
                    {t('auditLog')}
                </Link>
            </div>
        </div>
    );
}
