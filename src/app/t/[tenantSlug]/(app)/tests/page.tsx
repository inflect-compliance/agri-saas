'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { DataTable, createColumns, useColumnsDropdown } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { useRouter } from 'next/navigation';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { FilterProvider, useFilterContext, useFilters, useFilterCardVisibility, filtersToCards, selectVisibleFilters } from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { KPIStat } from '@/components/ui/metric';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cardVariants } from '@/components/ui/card';
import { AppIcon } from '@/components/icons/AppIcon';
import { Tooltip } from '@/components/ui/tooltip';
import { buildTestFilters, TEST_FILTER_KEYS } from './filter-defs';

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
// Audit Coherence S2 — TestPlanStatus values: ACTIVE / PAUSED /
// ARCHIVED. ARCHIVED is the terminal "retired control test" state
// (preserved for historical audit, no new runs). Pre-S2 the UI
// only knew about ACTIVE / PAUSED.
const PLAN_STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    ACTIVE: 'success',
    PAUSED: 'warning',
    ARCHIVED: 'neutral',
};

const isOverdue = (d: string | null) => {
    if (!d) return false;
    return new Date(d) < new Date();
};

const getLastResult = (plan: TestPlanSummary) => {
    if (!plan.runs || plan.runs.length === 0) return null;
    return plan.runs[0]?.result;
};

export default function TestsRollupPage() {
    // Filter state lives in the URL-synced filter context; the page
    // filters its in-memory plan list off `state` + `search`.
    const filterCtx = useFilterContext([], TEST_FILTER_KEYS, {});
    return (
        <FilterProvider value={filterCtx}>
            <TestsRollupContent />
        </FilterProvider>
    );
}

function TestsRollupContent() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const { state, search, hasActive } = useFilters();

    const [plans, setPlans] = useState<TestPlanSummary[]>([]);
    const [loading, setLoading] = useState(true);

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

    // ── Column-visibility gear (Epic 52/R10) ──
    const {
        columnVisibility,
        setColumnVisibility,
        orderColumns,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:tests',
        columns: [
            { id: 'name', label: 'Name' },
            { id: 'status', label: 'Status' },
            { id: 'control', label: 'Control' },
            { id: 'frequency', label: 'Frequency' },
            { id: 'nextDue', label: 'Next Due' },
            { id: 'lastResult', label: 'Last Result' },
            { id: 'runs', label: 'Runs' },
        ],
    });

    const liveFilters = useMemo(() => buildTestFilters(), []);

    const filterCards = useMemo(() => filtersToCards(liveFilters), [liveFilters]);
    const { visibleCards, dropdown: filtersDropdown } = useFilterCardVisibility({
        storageKey: 'inflect:filter-vis:tests',
        cards: filterCards,
    });
    const visibleFilterDefs = useMemo(
        () => selectVisibleFilters(visibleCards, liveFilters),
        [visibleCards, liveFilters],
    );

    // ── Client-side filtering from the filter context ──
    const filteredPlans = useMemo(() => {
        const statusSel = state.status ?? [];
        const resultSel = state.result ?? [];
        const freqSel = state.frequency ?? [];
        const dueSel = state.due ?? [];
        const q = search.trim().toLowerCase();
        return plans.filter((p) => {
            if (statusSel.length && !statusSel.includes(p.status)) return false;
            const result = getLastResult(p) ?? 'NONE';
            if (resultSel.length && !resultSel.includes(result)) return false;
            if (freqSel.length && !freqSel.includes(p.frequency)) return false;
            if (
                dueSel.includes('overdue') &&
                !(p.nextDueAt && isOverdue(p.nextDueAt))
            ) {
                return false;
            }
            if (q && !p.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [plans, state, search]);

    // Stats (display-only headline figures).
    const dueCount = plans.filter((p) => p.nextDueAt && isOverdue(p.nextDueAt)).length;
    const failedCount = plans.filter((p) => getLastResult(p) === 'FAIL').length;
    const passedCount = plans.filter((p) => getLastResult(p) === 'PASS').length;

    const planColumns = useMemo(
        () =>
            orderColumns(createColumns<TestPlanSummary>([
                {
                    id: 'name', header: 'Name', accessorKey: 'name',
                    cell: ({ row }) => (
                        <Link
                            href={tenantHref(`/controls/${row.original.control.id}/tests/${row.original.id}`)}
                            className="text-content-emphasis font-medium hover:text-[var(--brand-default)] transition"
                        >
                            {row.original.name}
                        </Link>
                    ),
                },
                {
                    id: 'status', header: 'Status', accessorKey: 'status',
                    cell: ({ row }) => (
                        <StatusBadge variant={PLAN_STATUS_BADGE[row.original.status] ?? 'neutral'} size="sm">
                            {row.original.status}
                        </StatusBadge>
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
            ])),
        [tenantHref, orderColumns],
    );

    if (loading) return <div className="p-12 text-center text-content-subtle animate-pulse">Loading tests overview...</div>;

    return (
        <ListPageShell className="animate-fadeIn gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <PageBreadcrumbs
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
                        <Tooltip content="Due queue">
                            <Link href={tenantHref('/tests/due')} aria-label="Due queue" className={buttonVariants({ variant: 'secondary', size: 'icon' })} id="tests-due-btn">
                                <AppIcon name="clock" size={16} />
                            </Link>
                        </Tooltip>
                        <Tooltip content="Dashboard">
                            <Link href={tenantHref('/tests/dashboard')} aria-label="Dashboard" className={buttonVariants({ variant: 'secondary', size: 'icon' })} id="tests-dashboard-btn">
                                <AppIcon name="dashboard" size={16} />
                            </Link>
                        </Tooltip>
                        <Tooltip content="Access reviews">
                            <Link href={tenantHref('/access-reviews')} aria-label="Access reviews" className={buttonVariants({ variant: 'secondary', size: 'icon' })} id="tests-uar-btn">
                                <AppIcon name="userCheck" size={16} />
                            </Link>
                        </Tooltip>
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-section">
                {/* Headline stats (display-only). */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat value={plans.length} label="Total Plans" />
                    </div>
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat value={dueCount} label="Overdue" tone={dueCount > 0 ? 'critical' : 'success'} />
                    </div>
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat value={failedCount} label="Last Failed" tone={failedCount > 0 ? 'critical' : 'success'} />
                    </div>
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat value={passedCount} label="Last Passed" tone="success" />
                    </div>
                </div>

                {/* Filter bar (Status / Last Result / Frequency / Due) +
                    live content search + column-visibility gear. Replaces
                    the old All/Overdue/Failed toggle blade. */}
                <FilterToolbar
                    filters={visibleFilterDefs}
                    searchId="tests-search"
                    searchPlaceholder="Search test plans…"
                    actions={<>{columnsDropdown}{filtersDropdown}</>}
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                <DataTable
                    fillBody
                    data={filteredPlans}
                    columns={planColumns}
                    getRowId={(p) => p.id}
                    columnVisibility={columnVisibility}
                    onColumnVisibilityChange={setColumnVisibility}
                    emptyState={
                        hasActive
                            ? 'No test plans match your filters.'
                            : 'No test plans found. Create test plans from the Control detail page.'
                    }
                    resourceName={(p) => p ? 'test plans' : 'test plan'}
                    data-testid="tests-rollup-table"
                    // Row hover band + brand left-band (and double-click →
                    // open the plan), matching every other list table.
                    onRowClick={(row) =>
                        router.push(
                            tenantHref(
                                `/controls/${row.original.control.id}/tests/${row.original.id}`,
                            ),
                        )
                    }
                />
            </ListPageShell.Body>
        </ListPageShell>
    );
}
