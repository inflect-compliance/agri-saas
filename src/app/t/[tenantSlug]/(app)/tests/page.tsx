'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { DataTable, createColumns } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface TestPlanSummary {
    id: string;
    name: string;
    frequency: string;
    status: string;
    nextDueAt: string | null;
    controlId: string;
    method: string;
    control: { id: string; name: string; code: string | null };
    owner?: { id: string; name: string | null; email: string } | null;
    _count?: { runs: number; steps: number };
    runs?: Array<{
        id: string;
        result: string | null;
        executedAt: string | null;
        status: string;
    }>;
}

const FREQ_LABELS: Record<string, string> = {
    AD_HOC: 'Ad Hoc', DAILY: 'Daily', WEEKLY: 'Weekly',
    MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually',
};
const RESULT_BADGE: Record<string, StatusBadgeVariant> = {
    PASS: 'success', FAIL: 'error', INCONCLUSIVE: 'warning',
};

export default function TestsRollupPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();
    void permissions;

    const [plans, setPlans] = useState<TestPlanSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'due' | 'failed' | 'passed'>('all');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl('/tests/plans'));
            if (res.ok) setPlans(await res.json());
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchData(); }, [fetchData]);

    const isOverdue = (d: string | null) => {
        if (!d) return false;
        return new Date(d) < new Date();
    };

    const getLastResult = (plan: TestPlanSummary) => {
        if (!plan.runs || plan.runs.length === 0) return null;
        return plan.runs[0]?.result;
    };

    const filteredPlans = plans.filter(p => {
        if (filter === 'due') return p.nextDueAt && isOverdue(p.nextDueAt);
        if (filter === 'failed') return getLastResult(p) === 'FAIL';
        if (filter === 'passed') return getLastResult(p) === 'PASS';
        return true;
    });

    // Stats
    const duePlans = plans.filter(p => p.nextDueAt && isOverdue(p.nextDueAt));
    const failedPlans = plans.filter(p => getLastResult(p) === 'FAIL');

    if (loading) return <div className="p-12 text-center text-content-subtle animate-pulse">Loading tests overview...</div>;

    return (
        <ListPageShell className="animate-fadeIn gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: tenantHref('/dashboard') },
                                { label: 'Tests' },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1} id="tests-page-title">Tests</Heading>
                        <p className="text-sm text-content-muted mt-1">Test plans and recent results across all controls</p>
                    </div>
                    <div className="flex gap-tight">
                        <Link href={tenantHref('/tests/due')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Due Queue</Link>
                        <Link href={tenantHref('/tests/dashboard')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Dashboard</Link>
                        <Link href={tenantHref('/findings')} className={buttonVariants({ variant: 'ghost', size: 'sm' })} id="findings-link-btn">Findings</Link>
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-section">
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                <div className="glass-card p-4 text-center cursor-pointer hover:ring-1 hover:ring-[color:var(--ring)] transition" onClick={() => setFilter('all')}>
                    <div className="text-2xl font-bold text-[var(--brand-default)]">{plans.length}</div>
                    <div className="text-xs text-content-muted mt-1">Total Plans</div>
                </div>
                <div className="glass-card p-4 text-center cursor-pointer hover:ring-1 hover:ring-[color:var(--ring)] transition" onClick={() => setFilter('due')}>
                    <div className={`text-2xl font-bold ${duePlans.length > 0 ? 'text-content-error' : 'text-content-success'}`}>
                        {duePlans.length}
                    </div>
                    <div className="text-xs text-content-muted mt-1">Overdue</div>
                </div>
                <div className="glass-card p-4 text-center cursor-pointer hover:ring-1 hover:ring-[color:var(--ring)] transition" onClick={() => setFilter('failed')}>
                    <div className={`text-2xl font-bold ${failedPlans.length > 0 ? 'text-content-error' : 'text-content-success'}`}>
                        {failedPlans.length}
                    </div>
                    <div className="text-xs text-content-muted mt-1">Last Failed</div>
                </div>
                <div className="glass-card p-4 text-center cursor-pointer hover:ring-1 hover:ring-[color:var(--ring)] transition" onClick={() => setFilter('passed')}>
                    <div className="text-2xl font-bold text-content-success">
                        {plans.filter(p => getLastResult(p) === 'PASS').length}
                    </div>
                    <div className="text-xs text-content-muted mt-1">Last Passed</div>
                </div>
            </div>

                {/* Filter Toggle — Epic 60: ToggleGroup size="sm" for a
                    compact radiogroup with keyboard arrow nav. */}
                <ToggleGroup
                    size="sm"
                    ariaLabel="Test plan filter"
                    options={[
                        { value: 'all', label: 'All' },
                        { value: 'due', label: 'Overdue' },
                        { value: 'failed', label: 'Failed' },
                    ]}
                    selected={filter}
                    selectAction={(v) => setFilter(v as 'all' | 'due' | 'failed')}
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                {/* Plans Table */}
                {(() => {
                const planColumns = createColumns<TestPlanSummary>([
                    {
                        id: 'plan', header: 'Plan', accessorKey: 'name',
                        cell: ({ row }) => (
                            <div>
                                <Link href={tenantHref(`/controls/${row.original.control.id}/tests/${row.original.id}`)} className="text-content-emphasis font-medium hover:text-[var(--brand-default)] transition">
                                    {row.original.name}
                                </Link>
                                <div className="flex items-center gap-1 mt-0.5">
                                    <StatusBadge variant={row.original.status === 'ACTIVE' ? 'success' : 'warning'} size="sm">
                                        {row.original.status}
                                    </StatusBadge>
                                </div>
                            </div>
                        ),
                    },
                    {
                        id: 'control', header: 'Control', accessorFn: (p) => p.control?.code || p.control?.name || '—',
                        cell: ({ row }) => (
                            <Link href={tenantHref(`/controls/${row.original.control.id}`)} className="text-content-muted hover:text-content-emphasis text-xs transition">
                                {row.original.control?.code || row.original.control?.name || '—'}
                            </Link>
                        ),
                    },
                    { id: 'frequency', header: 'Frequency', accessorFn: (p) => FREQ_LABELS[p.frequency] || p.frequency },
                    {
                        id: 'nextDue', header: 'Next Due', accessorKey: 'nextDueAt',
                        cell: ({ row }) => row.original.nextDueAt ? (
                            <span className={isOverdue(row.original.nextDueAt) ? 'text-content-error font-semibold' : 'text-content-muted'}>
                                {formatDate(row.original.nextDueAt)}
                            </span>
                        ) : <span className="text-content-subtle">—</span>,
                    },
                    {
                        id: 'lastResult', header: 'Last Result',
                        accessorFn: (p) => getLastResult(p) || '',
                        cell: ({ row }) => {
                            const result = getLastResult(row.original);
                            return result ? (
                                <StatusBadge variant={RESULT_BADGE[result] || 'neutral'} size="sm">{result}</StatusBadge>
                            ) : <span className="text-content-subtle text-xs">No runs</span>;
                        },
                    },
                    {
                        id: 'runs', header: 'Runs',
                        accessorFn: (p) => p._count?.runs ?? 0,
                        cell: ({ getValue }) => <span className="text-content-subtle">{getValue() as number}</span>,
                    },
                    {
                        id: 'actions', header: '',
                        cell: ({ row }) => (
                            <Link href={tenantHref(`/controls/${row.original.control.id}/tests/${row.original.id}`)} className="text-xs text-[var(--brand-default)] hover:underline">
                                View →
                            </Link>
                        ),
                    },
                ]);
                return (
                    <DataTable
                        fillBody
                        data={filteredPlans}
                        columns={planColumns}
                        getRowId={(p) => p.id}
                        emptyState={filter === 'all' ? 'No test plans found. Create test plans from the Control detail page.' : `No ${filter === 'due' ? 'overdue' : 'failed'} test plans.`}
                        resourceName={(p) => p ? 'test plans' : 'test plan'}
                        data-testid="tests-rollup-table"
                        className="hover:bg-bg-muted"
                    />
                );
            })()}
            </ListPageShell.Body>
        </ListPageShell>
    );
}
