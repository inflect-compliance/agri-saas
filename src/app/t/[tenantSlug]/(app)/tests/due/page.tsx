'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable @typescript-eslint/no-explicit-any -- Client component receiving server-rendered domain data; tanstack column callbacks; or library-boundary callbacks. Per-site narrowing requires generated DTOs / per-cell CellContext imports — out of scope for the lint cleanup PR. */
import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { DataTable, createColumns } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { IconAction } from '@/components/ui/icon-action';
import { AppIcon } from '@/components/icons/AppIcon';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { KPIStat } from '@/components/ui/metric';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface DuePlan {
    id: string;
    name: string;
    frequency: string;
    nextDueAt: string | null;
    controlId: string;
    isOverdue: boolean;
    hasPendingRun: boolean;
    control: { id: string; name: string; code: string | null };
    owner: { id: string; name: string | null; email: string } | null;
    _count: { runs: number };
}

const FREQ_LABELS: Record<string, string> = {
    AD_HOC: 'Ad Hoc', DAILY: 'Daily', WEEKLY: 'Weekly',
    MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually',
};

export default function DueQueuePage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();

    const [queue, setQueue] = useState<DuePlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [planning, setPlanning] = useState(false);
    const [planningResult, setPlanningResult] = useState<{ checked: number; created: number; alreadyPending: number } | null>(null);
    const [error, setError] = useState('');

    const fetchQueue = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl('/tests/due'));
            if (res.ok) setQueue(await res.json());
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchQueue(); }, [fetchQueue]);

    const handleRunDuePlanning = async () => {
        setPlanning(true);
        setPlanningResult(null);
        setError('');
        try {
            const res = await fetch(apiUrl('/tests/due'), { method: 'POST' });
            if (res.ok) {
                const result = await res.json();
                setPlanningResult(result);
                await fetchQueue();
            } else {
                setError('Failed to run due planning');
            }
        } finally {
            setPlanning(false);
        }
    };

    const handleQuickRun = async (planId: string) => {
        const res = await fetch(apiUrl(`/tests/plans/${planId}/runs`), { method: 'POST' });
        if (res.ok) {
            const run = await res.json();
            // window.location.href setter triggers full navigation — used
            // here intentionally to leave the SPA shell after a sync
            // POST. Inside an async callback, not in render.
            // eslint-disable-next-line react-hooks/immutability
            window.location.href = tenantHref(`/tests/runs/${run.id}`);
        }
    };

    const overdueCount = queue.filter(p => p.isOverdue).length;
    const pendingCount = queue.filter(p => p.hasPendingRun).length;

    if (loading) return <div className="p-12 text-center text-content-subtle animate-pulse">Loading due queue...</div>;

    return (
        <ListPageShell className="animate-fadeIn gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <Heading level={1} id="due-queue-title">Due Queue</Heading>
                        <p className="text-sm text-content-muted mt-1">Test plans due or overdue for execution</p>
                    </div>
                    <div className="flex gap-compact">
                        <Link href={tenantHref('/tests')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>← Tests</Link>
                        <Link href={tenantHref('/tests/dashboard')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Dashboard</Link>
                        {permissions.canWrite && (
                            <IconAction
                                variant="primary"
                                onClick={handleRunDuePlanning}
                                loading={planning}
                                id="run-due-planning-btn"
                                icon={<AppIcon name="run" size={16} />}
                                label="Run due planning"
                            />
                        )}
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-section">
                {/* Planning result */}
            {planningResult && (
                <div className={cn(cardVariants({ density: 'compact' }), 'border border-border-success bg-bg-success')} id="planning-result">
                    <p className="text-sm text-content-success">
                        Due planning complete: checked {planningResult.checked} plans,
                        created {planningResult.created} new runs,
                        {planningResult.alreadyPending} already had pending runs.
                    </p>
                </div>
            )}
            {error && <div className={cn(cardVariants({ density: 'compact' }), 'border border-border-error text-content-error text-sm')}>{error}</div>}

            {/* Stats — Polish PR-2: KPIStat primitive. */}
            <div className="grid grid-cols-3 gap-default">
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat value={queue.length} label="Due / Due Soon" />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat value={overdueCount} label="Overdue" tone={overdueCount > 0 ? 'critical' : 'success'} />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat value={pendingCount} label="Pending Runs" tone={pendingCount > 0 ? 'attention' : 'default'} />
                </div>
            </div>

            </ListPageShell.Filters>

            <ListPageShell.Body>
                {/* Queue Table */}
                {(() => {
                const dueColumns = createColumns<DuePlan>([
                    {
                        id: 'plan', header: 'Plan', accessorKey: 'name',
                        cell: ({ row }) => (
                            <Link href={tenantHref(`/controls/${row.original.controlId}/tests/${row.original.id}`)} className="text-content-emphasis font-medium hover:text-[var(--brand-default)] transition">
                                {row.original.name}
                            </Link>
                        ),
                    },
                    {
                        id: 'control', header: 'Control', accessorFn: (p) => p.control?.code || p.control?.name || '—',
                        cell: ({ row }) => (
                            <Link href={tenantHref(`/controls/${row.original.controlId}`)} className="text-content-muted hover:text-content-emphasis text-xs transition">
                                {row.original.control?.code || row.original.control?.name || '—'}
                            </Link>
                        ),
                    },
                    { id: 'frequency', header: 'Frequency', accessorFn: (p) => FREQ_LABELS[p.frequency] || p.frequency },
                    {
                        id: 'dueDate', header: 'Due Date', accessorKey: 'nextDueAt',
                        cell: ({ row }) => (
                            <span className={row.original.isOverdue ? 'text-content-error font-semibold' : 'text-content-warning'}>
                                {formatDate(row.original.nextDueAt)}
                                {row.original.isOverdue && ' !'}
                            </span>
                        ),
                    },
                    { id: 'owner', header: 'Owner', accessorFn: (p) => p.owner?.name || p.owner?.email || '—', cell: ({ getValue }: any) => <span className="text-content-muted text-xs">{getValue()}</span> },
                    {
                        id: 'status', header: 'Status',
                        cell: ({ row }) => row.original.hasPendingRun
                            ? <StatusBadge variant="warning" size="sm">Run Pending</StatusBadge>
                            : <StatusBadge variant="error" size="sm">Needs Run</StatusBadge>,
                    },
                    {
                        id: 'actions', header: '',
                        cell: ({ row }) => !row.original.hasPendingRun && permissions.canWrite ? (
                            <Button variant="primary" size="xs" onClick={() => handleQuickRun(row.original.id)}>Run Now</Button>
                        ) : null,
                    },
                ]);
                return (
                    <DataTable
                        fillBody
                        data={queue}
                        columns={dueColumns}
                        getRowId={(p) => p.id}
                        emptyState="No tests are due! All plans are on schedule."
                        resourceName={(p) => p ? 'test plans' : 'test plan'}
                        data-testid="due-queue-table"
                    />
                );
            })()}
            </ListPageShell.Body>
        </ListPageShell>
    );
}
