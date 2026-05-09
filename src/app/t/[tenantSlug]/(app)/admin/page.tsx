import { getTranslations } from 'next-intl/server';
import { getTenantCtx } from '@/app-layer/context';
import { listAuditLogs } from '@/app-layer/usecases/auditLog';
import { Shield, CreditCard, KeyRound, ShieldCheck, ShieldPlus, Users, CloudCog, Plug, Palette, Grid3x3 } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { AdminClient } from './AdminClient';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

export const dynamic = 'force-dynamic';

/**
 * Admin — Server Component wrapper.
 * Fetches audit log server-side, renders navigation links server-side,
 * delegates only tab switching to client island.
 */
export default async function AdminPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;

    // Translations and tenant context are independent — fetch in parallel
    const [t, tc, ctx] = await Promise.all([
        getTranslations('admin'),
        getTranslations('common'),
        getTenantCtx({ tenantSlug }),
    ]);

    let auditLog: unknown[] = [];
    try {
        auditLog = await listAuditLogs(ctx);
    } catch {
        // User may not have AUDITOR/ADMIN role — gracefully degrade
        auditLog = [];
    }

    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;

    const templateKeys = [
        'infoSecurity', 'accessControl', 'incidentResponse', 'acceptableUse',
        'supplierSecurity', 'backup', 'changeManagement', 'cryptography', 'logging',
    ] as const;

    const templateLabels: Record<string, string> = {};
    for (const key of templateKeys) {
        templateLabels[key] = t(`templates.${key}`);
    }

    return (
        <div className="space-y-section animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <Breadcrumbs
                        items={[
                            { label: 'Dashboard', href: tenantHref('/dashboard') },
                            { label: t('title') },
                        ]}
                        className="mb-1"
                    />
                    <Heading level={1}>{t('title')}</Heading>
                </div>
                <div className="flex items-center gap-compact glass-card px-4 py-2" id="admin-theme-section">
                    <Palette className="w-4 h-4 text-content-muted" />
                    <span className="text-sm text-content-muted">Theme</span>
                    <ThemeToggle id="admin-theme-toggle" />
                </div>
            </div>

            {/* Navigation links — server-rendered, no JS needed */}
            <div className="flex gap-tight flex-wrap">
                {/* Tab buttons are rendered inside the client island below */}
            </div>

            {/* Navigation pills — pure server-rendered links */}
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
                    href={tenantHref('/admin/integrations')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="integrations-pill-btn"
                >
                    <Plug className="w-3.5 h-3.5" />
                    Integrations
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
                    href={tenantHref('/admin/risk-matrix')}
                    className={buttonVariants({ variant: 'secondary' })}
                    id="risk-matrix-pill-btn"
                >
                    <Grid3x3 className="w-3.5 h-3.5" />
                    Risk Matrix
                </Link>
            </div>

            {/* Interactive tabs — client island */}
            <AdminClient
                auditLog={JSON.parse(JSON.stringify(auditLog))}
                tenantSlug={tenantSlug}
                translations={{
                    title: t('title'),
                    auditLog: t('auditLog'),
                    policyTemplates: t('policyTemplates'),
                    time: t('time'),
                    user: t('user'),
                    action: t('action'),
                    entity: t('entity'),
                    details: t('details'),
                    noEntries: t('noEntries'),
                    templateDescription: t('templateDescription'),
                    clickToUse: t('clickToUse'),
                    templateLabels,
                }}
            />
        </div>
    );
}
