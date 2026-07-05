'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBreakdown, type StatusBreakdownItem } from '@/components/ui/status-breakdown';
import { type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { KPIStat, type MetricTone } from '@/components/ui/metric';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SkeletonDashboard } from '@/components/ui/skeleton';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { cardVariants } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { AppIcon } from '@/components/icons/AppIcon';
import { cn } from '@/lib/cn';


function MetricCard({ label, value, tone, href }: { label: string; value: number | string; tone?: MetricTone; href?: string }) {
    const inner = (
        <div className={`card p-4 ${href ? 'hover:bg-bg-muted/50 cursor-pointer' : ''}`}>
            <KPIStat value={value} label={label} tone={tone} />
        </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
}

function BreakdownBar({ data, colors }: { data: Record<string, number>; colors: Record<string, string> }) {
    // Epic 59 — hand-rolled per-row distribution bar replaced with the
    // shared `<StatusBreakdown>`. Preserves the legacy category-
    // specific colour palette via `colorClass` since these are
    // historically-branded vendor-risk / vendor-status colours, not
    // semantic variants.
    const items: StatusBreakdownItem[] = Object.entries(data).map(
        ([key, value]) => ({
            id: key,
            label: key,
            value,
            colorClass: colors[key] ?? 'bg-bg-info',
        }),
    );
    return <StatusBreakdown items={items} size="sm" showDot={false} />;
}

const CRIT_COLORS: Record<string, string> = {
    LOW: 'bg-bg-success', MEDIUM: 'bg-bg-warning', HIGH: 'bg-orange-500/60', CRITICAL: 'bg-bg-error',
};
const STATUS_COLORS: Record<string, string> = {
    ACTIVE: 'bg-bg-success', ONBOARDING: 'bg-bg-info', OFFBOARDING: 'bg-bg-warning', OFFBOARDED: 'bg-border-emphasis',
};

export default function VendorDashboardPage() {
    const t = useTranslations('vendors.dashboard');
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [metrics, setMetrics] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchMetrics = useCallback(async () => {
        const res = await fetch(apiUrl('/vendors/metrics'));
        if (res.ok) setMetrics(await res.json());
        setLoading(false);
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

    if (loading) return <SkeletonDashboard />;
    if (!metrics) return <div className="text-content-error py-8 text-center">{t('failed')}</div>;

    return (
        <DashboardLayout
            header={{
                title: t('title'),
                description: t('totalDesc', { count: metrics.totalVendors }),
                actions: (
                    <Tooltip content={t('registerTooltip')}>
                        <Link href={tenantHref('/vendors')} aria-label={t('registerTooltip')} className={buttonVariants({ variant: 'secondary', size: 'icon' })}>
                            <AppIcon name="overview" size={16} />
                        </Link>
                    </Tooltip>
                ),
            }}
        >

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-default">
                <MetricCard label={t('totalVendors')} value={metrics.totalVendors} />
                <MetricCard label={t('overdueReviews')} value={metrics.overdueReview} tone={metrics.overdueReview > 0 ? 'critical' : 'success'}
                    href={tenantHref('/vendors?reviewDue=overdue')} />
                <MetricCard label={t('upcomingReviews')} value={metrics.upcomingReview} tone="attention" />
                <MetricCard label={t('overdueRenewals')} value={metrics.overdueRenewal} tone={metrics.overdueRenewal > 0 ? 'critical' : 'success'} />
                <MetricCard label={t('upcomingRenewals')} value={metrics.upcomingRenewal} tone="attention" />
                <MetricCard label={t('highRiskNoAssessment')} value={metrics.highRiskNoAssessment} tone={metrics.highRiskNoAssessment > 0 ? 'critical' : 'success'} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-section">
                {/* By Criticality */}
                <div className={cn(cardVariants(), 'space-y-compact')}>
                    <Heading level={3}>{t('byCriticality')}</Heading>
                    <BreakdownBar data={metrics.byCriticality} colors={CRIT_COLORS} />
                </div>

                {/* By Status */}
                <div className={cn(cardVariants(), 'space-y-compact')}>
                    <Heading level={3}>{t('byStatus')}</Heading>
                    <BreakdownBar data={metrics.byStatus} colors={STATUS_COLORS} />
                </div>

                {/* By Risk Rating */}
                <div className={cn(cardVariants(), 'space-y-compact')}>
                    <Heading level={3}>{t('byRiskRating')}</Heading>
                    {Object.keys(metrics.byRiskRating).length > 0
                        ? <BreakdownBar data={metrics.byRiskRating} colors={CRIT_COLORS} />
                        : <InlineEmptyState title={t('noAssessments')} />}
                </div>
            </div>

            {/* Expiring Documents */}
            {metrics.expiringDocuments > 0 && (
                <div className={cn(cardVariants(), 'border border-orange-500/30')}>
                    <div className="flex items-center gap-tight">
                        <span className="text-orange-400 text-lg font-semibold">!</span>
                        <span className="font-semibold">{t('expiringDocs', { count: metrics.expiringDocuments })}</span>
                    </div>
                    <p className="text-sm text-content-muted mt-1">{t('expiringHint')}</p>
                </div>
            )}
        </DashboardLayout>
    );
}
