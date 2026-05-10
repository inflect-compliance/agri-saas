'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import type { ControlDashboardDTO, ConsistencyCheckDTO } from '@/lib/dto';
import { AppIcon } from '@/components/icons/AppIcon';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { ProgressBar } from '@/components/ui/progress-bar';
import {
    StatusBreakdown,
    type StatusBreakdownVariant,
} from '@/components/ui/status-breakdown';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Card, cardVariants } from '@/components/ui/card';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { KPIStat } from '@/components/ui/metric';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SkeletonDashboard } from '@/components/ui/skeleton';

const STATUS_LABELS: Record<string, string> = {
    NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', IMPLEMENTED: 'Implemented', NEEDS_REVIEW: 'Needs Review',
};
// Map control status onto semantic StatusBreakdown variants so the
// distribution bar re-themes cleanly under Epic 51 light-mode. Drops
// the hand-picked hex palette (#94a3b8/#38bdf8/#34d399/#fbbf24) the
// inline bar used.
const STATUS_VARIANT: Record<string, StatusBreakdownVariant> = {
    NOT_STARTED: 'neutral',
    IN_PROGRESS: 'info',
    IMPLEMENTED: 'success',
    NEEDS_REVIEW: 'warning',
};

export default function ControlsDashboard() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();

    const [data, setData] = useState<ControlDashboardDTO | null>(null);
    const [loading, setLoading] = useState(true);
    const [consistency, setConsistency] = useState<ConsistencyCheckDTO | null>(null);
    const [showConsistency, setShowConsistency] = useState(false);

    // Was a recursive useCallback (`fetchDashboard(attempt + 1)` in
    // its own body) — the React Compiler immutability rule fired
    // because the closure references its own not-yet-finalised
    // binding. Refactored to an inline retry loop, which is also
    // simpler to read.
    const fetchDashboard = useCallback(async () => {
        setLoading(true);
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetch(apiUrl('/controls/dashboard'));
                if (res.ok) {
                    setData(await res.json());
                    break;
                }
            } catch {
                // Fall through to retry below.
            }
            if (attempt < 2) {
                // Retry on server errors (e.g., dev server compilation race)
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        setLoading(false);
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

    const fetchConsistency = async () => {
        setShowConsistency(true);
        const res = await fetch(apiUrl('/controls/consistency-check'));
        if (res.ok) setConsistency(await res.json());
    };

    if (loading) return <SkeletonDashboard />;
    if (!data) return (
        <DashboardLayout header={{ title: 'Controls Dashboard', titleId: 'dashboard-heading' }}>
            <div className="p-12 text-center text-content-error">Failed to load dashboard.</div>
        </DashboardLayout>
    );

    return (
        <DashboardLayout
            header={{
                title: 'Controls Dashboard',
                titleId: 'dashboard-heading',
                description: `${data.totalControls} controls in register`,
                actions: (
                    <>
                        {permissions.canAdmin && (
                            <Button variant="secondary" onClick={fetchConsistency} id="consistency-check-btn">
                                <AppIcon name="search" size={16} className="inline-block" /> Consistency Check
                            </Button>
                        )}
                        <Link href={tenantHref('/controls')} className={buttonVariants({ variant: 'secondary' })}>
                            Back to Controls
                        </Link>
                    </>
                ),
            }}
        >
            {/* Stat Cards Row — Polish PR-2: KPIStat primitive. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-default" id="dashboard-stats">
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat
                        id="implementation-progress"
                        value={`${data.implementationProgress}%`}
                        label="Implementation Progress"
                        tone="success"
                        description={`${data.implementedCount}/${data.applicableCount} applicable controls`}
                    />
                    <ProgressBar
                        value={data.implementationProgress}
                        variant={data.implementationProgress >= 80 ? 'success' : data.implementationProgress >= 50 ? 'warning' : 'error'}
                        size="sm"
                        aria-label="Control implementation progress"
                        className="mt-2"
                    />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat
                        id="overdue-tasks"
                        value={data.overdueTasks}
                        label="Overdue Tasks"
                        tone={data.overdueTasks > 0 ? 'critical' : 'default'}
                        description="tasks past due date"
                    />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat
                        id="due-soon"
                        value={data.controlsDueSoon}
                        label="Controls Due Soon"
                        tone={data.controlsDueSoon > 0 ? 'attention' : 'default'}
                        description="within next 30 days"
                    />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat
                        value={data.applicabilityDistribution.applicable}
                        label="Applicability"
                        description={`${data.applicabilityDistribution.notApplicable} excluded (N/A)`}
                    />
                </div>
            </div>

            {/* Status Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                <Card>
                    <Heading level={3} className="mb-4">Status Distribution</Heading>
                    {/* Epic 59 — StatusBreakdown primitive. Bar widths are
                        proportional to the row's share of `total`
                        (maxStatus in the local scope was the previous
                        denominator; totalling the counts gives the same
                        share for "max == sum" — i.e. a one-hot winner
                        fills the track, everyone else scales down). */}
                    <div id="status-distribution">
                        <StatusBreakdown
                            ariaLabel="Control status distribution"
                            showDot={false}
                            size="sm"
                            items={Object.entries(
                                data.statusDistribution || {},
                            ).map(([status, count]) => ({
                                id: status,
                                label: STATUS_LABELS[status] || status,
                                value: Number(count),
                                variant:
                                    STATUS_VARIANT[status] ?? 'neutral',
                            }))}
                        />
                    </div>
                </Card>
                <Card>
                    <Heading level={3} className="mb-4">Top Owners by Open Tasks</Heading>
                    {data.topOwners?.length > 0 ? (
                        <div className="space-y-tight" id="top-owners">
                            {data.topOwners.map((o) => (
                                <div key={o.id} className="flex justify-between items-center text-sm">
                                    <span className="text-content-default">{o.name}</span>
                                    <StatusBadge variant="neutral">{o.openTasks} open</StatusBadge>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <InlineEmptyState title="No assigned owners yet" />
                    )}
                </Card>
            </div>

            {/* Consistency Check */}
            {showConsistency && consistency && (
                <Card id="consistency-results">
                    <Heading level={3} className="mb-3"><AppIcon name="search" size={16} className="inline-block mr-1" /> Consistency Check Results</Heading>
                    <div className="grid grid-cols-3 gap-default mb-4">
                        <div className="text-center">
                            <p className={`text-xl font-bold ${consistency.summary.missingCodeCount > 0 ? 'text-content-warning' : 'text-content-success'}`}>
                                {consistency.summary.missingCodeCount}
                            </p>
                            <p className="text-xs text-content-subtle">Missing Code</p>
                        </div>
                        <div className="text-center">
                            <p className={`text-xl font-bold ${consistency.summary.duplicateCodeCount > 0 ? 'text-content-error' : 'text-content-success'}`}>
                                {consistency.summary.duplicateCodeCount}
                            </p>
                            <p className="text-xs text-content-subtle">Duplicate Codes</p>
                        </div>
                        <div className="text-center">
                            <p className={`text-xl font-bold ${consistency.summary.overdueTaskCount > 0 ? 'text-content-error' : 'text-content-success'}`}>
                                {consistency.summary.overdueTaskCount}
                            </p>
                            <p className="text-xs text-content-subtle">Overdue Tasks</p>
                        </div>
                    </div>
                    {consistency.summary.missingCodeCount === 0 && consistency.summary.duplicateCodeCount === 0 && consistency.summary.overdueTaskCount === 0 && (
                        <p className="text-sm text-content-success text-center"><AppIcon name="success" size={16} className="inline-block mr-1" /> All checks passed — no issues found</p>
                    )}
                </Card>
            )}
        </DashboardLayout>
    );
}
