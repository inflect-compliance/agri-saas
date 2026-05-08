'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBreakdown, type StatusBreakdownItem } from '@/components/ui/status-breakdown';

const CRIT_BADGE: Record<string, string> = { LOW: 'badge-neutral', MEDIUM: 'badge-warning', HIGH: 'badge-danger', CRITICAL: 'badge-danger' };

function MetricCard({ label, value, badge, href }: { label: string; value: number | string; badge?: string; href?: string }) {
    const inner = (
        <div className={`card p-4 text-center ${href ? 'hover:bg-bg-elevated/50 cursor-pointer' : ''}`}>
            <div className={`text-2xl font-bold ${badge || ''}`}>{value}</div>
            <div className="text-xs text-content-muted mt-1">{label}</div>
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

    if (loading) return <div className="text-content-muted py-8 text-center">Loading dashboard…</div>;
    if (!metrics) return <div className="text-content-error py-8 text-center">Failed to load metrics</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Vendor Dashboard</h1>
                    <p className="text-content-muted text-sm">{metrics.totalVendors} total vendors</p>
                </div>
                <Link href={tenantHref('/vendors')} className={buttonVariants({ variant: 'secondary' })}>← Register</Link>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <MetricCard label="Total Vendors" value={metrics.totalVendors} />
                <MetricCard label="Overdue Reviews" value={metrics.overdueReview} badge={metrics.overdueReview > 0 ? 'text-content-error' : 'text-content-success'}
                    href={tenantHref('/vendors?reviewDue=overdue')} />
                <MetricCard label="Upcoming Reviews" value={metrics.upcomingReview} badge="text-content-warning" />
                <MetricCard label="Overdue Renewals" value={metrics.overdueRenewal} badge={metrics.overdueRenewal > 0 ? 'text-content-error' : 'text-content-success'} />
                <MetricCard label="Upcoming Renewals" value={metrics.upcomingRenewal} badge="text-content-warning" />
                <MetricCard label="High Risk (No Assessment)" value={metrics.highRiskNoAssessment} badge={metrics.highRiskNoAssessment > 0 ? 'text-content-error' : 'text-content-success'} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* By Criticality */}
                <div className="card p-5 space-y-3">
                    <h3 className="font-semibold">By Criticality</h3>
                    <BreakdownBar data={metrics.byCriticality} colors={CRIT_COLORS} />
                </div>

                {/* By Status */}
                <div className="card p-5 space-y-3">
                    <h3 className="font-semibold">By Status</h3>
                    <BreakdownBar data={metrics.byStatus} colors={STATUS_COLORS} />
                </div>

                {/* By Risk Rating */}
                <div className="card p-5 space-y-3">
                    <h3 className="font-semibold">By Risk Rating</h3>
                    {Object.keys(metrics.byRiskRating).length > 0
                        ? <BreakdownBar data={metrics.byRiskRating} colors={CRIT_COLORS} />
                        : <div className="text-sm text-content-subtle">No assessments completed yet</div>}
                </div>
            </div>

            {/* Expiring Documents */}
            {metrics.expiringDocuments > 0 && (
                <div className="card p-5 border border-orange-500/30">
                    <div className="flex items-center gap-2">
                        <span className="text-orange-400 text-lg font-semibold">!</span>
                        <span className="font-semibold">{metrics.expiringDocuments} document(s) expiring within 30 days</span>
                    </div>
                    <p className="text-sm text-content-muted mt-1">Review vendor documents tab to check validity dates.</p>
                </div>
            )}
        </div>
    );
}
