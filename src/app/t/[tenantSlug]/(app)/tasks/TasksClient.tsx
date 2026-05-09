'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable react-hooks/exhaustive-deps -- Various useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers/derived arrays recreated each render). The proper structural fix is wrapping parent-level callbacks in useCallback. Tracked as follow-up; existing per-line eslint-disable-next-line markers preserved. */
import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppIcon } from '@/components/icons/AppIcon';
import { useSWRConfig } from 'swr';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantMutation } from '@/lib/hooks/use-tenant-mutation';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';
import { TERMINAL_WORK_ITEM_STATUSES } from '@/app-layer/domain/work-item-status';
import { DataTable, createColumns } from '@/components/ui/table';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import { buildTaskFilters, TASK_FILTER_KEYS } from './filter-defs';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'neutral', TRIAGED: 'info', IN_PROGRESS: 'info',
    BLOCKED: 'error', RESOLVED: 'success', CLOSED: 'neutral', CANCELED: 'neutral',
};
const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open', TRIAGED: 'Triaged', IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked', RESOLVED: 'Resolved', CLOSED: 'Closed', CANCELED: 'Canceled',
};
const SEVERITY_BADGE: Record<string, StatusBadgeVariant> = {
    INFO: 'neutral', LOW: 'neutral', MEDIUM: 'warning',
    HIGH: 'error', CRITICAL: 'error',
};
const TYPE_LABELS: Record<string, string> = {
    AUDIT_FINDING: 'Audit Finding', CONTROL_GAP: 'Control Gap',
    INCIDENT: 'Incident', IMPROVEMENT: 'Improvement', TASK: 'Task',
};
const STATUS_OPTIONS = ['OPEN', 'TRIAGED', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED', 'CANCELED'];
const STATUS_CB_OPTIONS: ComboboxOption[] = STATUS_OPTIONS.map(s => ({ value: s, label: STATUS_LABELS[s] || s }));
const BULK_ACTION_OPTIONS: ComboboxOption[] = [
    { value: 'assign', label: 'Assign' },
    { value: 'status', label: 'Change Status' },
    { value: 'due', label: 'Set Due Date' },
];

// SLA windows (hours)
const SLA_RESOLVE: Record<string, number> = { CRITICAL: 24, HIGH: 72, MEDIUM: 168, LOW: 720 };

function getSlaLabel(severity: string, createdAt: string, status: string, now: Date): string {
    if ((TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(status)) return '';
    const hours = SLA_RESOLVE[severity];
    if (!hours) return '';
    const deadline = new Date(new Date(createdAt).getTime() + hours * 3600000);
    return now > deadline ? 'SLA Breached' : '';
}

interface TaskListItem {
    id: string;
    key: string | null;
    title: string;
    type: string;
    severity: string;
    status: string;
    dueAt: string | null;
    createdAt: string;
    updatedAt: string;
    assignee: { name: string } | null;
    assigneeUserId: string | null;
}

interface TasksClientProps {
    initialTasks: TaskListItem[];
    initialFilters?: Record<string, string>;
    tenantSlug: string;
    appPermissions: {
        tasks: { create: boolean; edit: boolean };
    };
}

/**
 * Client island for tasks — handles filters, bulk selection, optimistic mutations.
 * Data arrives pre-fetched from the server component, hydrated into React Query.
 */
export function TasksClient(props: TasksClientProps) {
    const filterCtx = useFilterContext([], TASK_FILTER_KEYS, {
        serverFilters: props.initialFilters,
    });
    return (
        <FilterProvider value={filterCtx}>
            <TasksPageInner {...props} />
        </FilterProvider>
    );
}

function TasksPageInner({
    initialTasks,
    initialFilters,
    tenantSlug,
    appPermissions,
}: TasksClientProps) {
    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const { mutate: swrMutate } = useSWRConfig();
    const router = useRouter();

    // Hydration marker — signals to E2E tests that React event handlers are attached
    const [hydrated, setHydrated] = useState(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setHydrated(true); }, []);

    // Null until after hydration — time-dependent UI (overdue/SLA
    // badges) reads this so SSR and first-client render match exactly.
    const hydratedNow = useHydratedNow();

    const { state, search, hasActive } = useFilters();

    // Bulk selection
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkAction, setBulkAction] = useState('');
    const [bulkValue, setBulkValue] = useState('');

    // ─── Query: tasks list (hydrated with server data) ───

    const fetchParams = useMemo(
        () => toApiSearchParams(state, { search }),
        [state, search],
    );
    const queryKeyFilters = useMemo(() => {
        const obj: Record<string, string> = {};
        for (const [k, v] of fetchParams) obj[k] = v;
        return obj;
    }, [fetchParams]);

    const serverHadFilters = initialFilters && Object.keys(initialFilters).length > 0;
    const filtersMatchInitial = useMemo(() => {
        if (!serverHadFilters) return !hasActive;
        const keys = new Set([...Object.keys(queryKeyFilters), ...Object.keys(initialFilters!)]);
        for (const k of keys) {
            if ((queryKeyFilters[k] ?? '') !== (initialFilters![k] ?? '')) return false;
        }
        return true;
    }, [queryKeyFilters, initialFilters, serverHadFilters, hasActive]);

    // Epic 69 — same SWR-first read pattern as policies / risks /
    // evidence / vendors. Filter-aware key + server-rendered
    // fallbackData (gated against filter divergence). The prior
    // `staleTime: 30_000` setting maps to SWR's
    // `dedupingInterval` — the Epic 69 hook's default is 5 s
    // already, so we bump it here to keep the previous behaviour
    // (dampens revalidation thrash during bulk-select interaction).
    const tasksKey = useMemo(() => {
        const qs = fetchParams.toString();
        return qs ? `${CACHE_KEYS.tasks.list()}?${qs}` : CACHE_KEYS.tasks.list();
    }, [fetchParams]);

    // PR-9 — API returns `{ rows, truncated }` (mirrors the seven
    // other list-page entities). SSR initial wraps with
    // `truncated: false` because the SSR cap (100) is well below
    // the backfill cap (5000) — the SSR slice never trips truncation
    // by itself.
    const tasksQuery = useTenantSWR<CappedList<TaskListItem>>(tasksKey, {
        fallbackData: filtersMatchInitial
            ? { rows: initialTasks, truncated: false }
            : undefined,
        dedupingInterval: 30_000,
    });

    const tasks = tasksQuery.data?.rows ?? [];
    const truncated = tasksQuery.data?.truncated ?? false;
    const loading = tasksQuery.isLoading && !tasksQuery.data;
    const liveFilters = useMemo(
        () => buildTaskFilters(tasks as unknown as Parameters<typeof buildTaskFilters>[0]),
        [tasks],
    );

    const isOverdue = (task: TaskListItem) => !!(hydratedNow && task.dueAt && new Date(task.dueAt) < hydratedNow && !(TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(task.status));

    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    const toggleSelectAll = () => {
        if (selected.size === tasks.length) setSelected(new Set());
        else setSelected(new Set(tasks.map(i => i.id)));
    };

    // ─── Mutation: bulk actions (Epic 69 — useTenantMutation) ────
    //
    // Migrated from React Query's `useMutation` + `onMutate` /
    // `onError` rollback hooks. The hook now handles the lifecycle
    // — `optimisticUpdate` walks the cached task list and patches
    // every selected row with the new field; rollback is automatic
    // on throw via `rollbackOnError: true` (the default). After
    // success the post-mutation revalidation refreshes the
    // current filter view, and `invalidateAllTasks()` below fans
    // out to sibling filter variants so a different filter view
    // doesn't show stale state.
    const invalidateAllTasks = useCallback(() => {
        const tasksUrlPrefix = apiUrl(CACHE_KEYS.tasks.list());
        return swrMutate(
            (key) =>
                typeof key === 'string' &&
                (key === tasksUrlPrefix ||
                    key.startsWith(`${tasksUrlPrefix}?`)),
            undefined,
            { revalidate: true },
        );
    }, [apiUrl, swrMutate]);

    interface BulkVars {
        action: string;
        value: string;
        ids: string[];
    }

    // PR-9 — cache value is `CappedList<TaskListItem>`; preserve the
    // `truncated` flag and only rewrite `rows`. Same shape change as
    // the other six SWR-backed clients (PR-5 corrective).
    const bulkMutation = useTenantMutation<CappedList<TaskListItem>, BulkVars, unknown>({
        key: tasksKey,
        mutationFn: async ({ action, value, ids }) => {
            let url = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const body: any = { taskIds: ids };

            if (action === 'assign') {
                url = apiUrl('/tasks/bulk/assign');
                body.assigneeUserId = value || null;
            } else if (action === 'status') {
                url = apiUrl('/tasks/bulk/status');
                body.status = value;
            } else if (action === 'due') {
                url = apiUrl('/tasks/bulk/due');
                body.dueAt = value || null;
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error('Bulk action failed');
            return res.json();
        },
        optimisticUpdate: (current, { action, value, ids }) => {
            const rows = (current?.rows ?? []).map((task) => {
                if (!ids.includes(task.id)) return task;
                if (action === 'status') return { ...task, status: value };
                if (action === 'assign')
                    return {
                        ...task,
                        assigneeUserId: value || null,
                        assignee: value ? { name: value } : null,
                    };
                if (action === 'due') return { ...task, dueAt: value || null };
                return task;
            });
            return { rows, truncated: current?.truncated ?? false };
        },
    });

    const handleBulkSubmit = () => {
        if (!bulkAction || selected.size === 0) return;
        bulkMutation
            .trigger({
                action: bulkAction,
                value: bulkValue,
                ids: Array.from(selected),
            })
            .catch(() => {
                /* rollback already applied by the hook */
            })
            .finally(() => {
                // Mirror the prior `onSettled` semantics — clear bulk
                // selection state and fan out invalidation to sibling
                // filter variants.
                invalidateAllTasks();
                setSelected(new Set());
                setBulkAction('');
                setBulkValue('');
            });
    };

    // ── Column definitions ──
    const taskColumns = useMemo(() => {
        const cols: ReturnType<typeof createColumns<TaskListItem>> = [];

        if (appPermissions.tasks.edit) {
            cols.push({
                id: 'select',
                header: () => (
                    <input
                        type="checkbox"
                        checked={selected.size === tasks.length && tasks.length > 0}
                        onChange={toggleSelectAll}
                        id="select-all-checkbox"
                        // GAP-CI-77: aria-label so the checkbox satisfies
                        // the axe-core `label` rule (no surrounding
                        // <label> element wraps it; the column header is
                        // visual only).
                        aria-label="Select all tasks"
                    />
                ),
                cell: ({ row }) => (
                    <input
                        type="checkbox"
                        checked={selected.has(row.original.id)}
                        onChange={() => toggleSelect(row.original.id)}
                        onClick={e => e.stopPropagation()}
                        className="task-checkbox"
                        aria-label={`Select task ${row.original.title}`}
                    />
                ),
                enableHiding: false,
                size: 32,
            });
        }

        cols.push(
            {
                id: 'title',
                header: 'Key / Title',
                accessorFn: (t) => t.title,
                cell: ({ row }) => {
                    const task = row.original;
                    const slaLabel = hydratedNow ? getSlaLabel(task.severity, task.createdAt, task.status, hydratedNow) : '';
                    return (
                        <div>
                            <Link href={tenantHref(`/tasks/${task.id}`)} className="font-medium text-content-emphasis hover:text-[var(--brand-default)] transition" onClick={(e) => e.stopPropagation()}>
                                {task.key && <span className="text-xs font-mono text-content-muted mr-2">{task.key}</span>}
                                {task.title}
                            </Link>
                            {isOverdue(task) && <StatusBadge variant="error" className="ml-2">Overdue</StatusBadge>}
                            {slaLabel && (
                                <Tooltip
                                    title="SLA Breached"
                                    content={slaLabel}
                                >
                                    <StatusBadge variant="error" className="ml-1 cursor-help">SLA</StatusBadge>
                                </Tooltip>
                            )}
                        </div>
                    );
                },
            },
            {
                accessorKey: 'type',
                header: 'Type',
                cell: ({ getValue }) => <span className="text-xs text-content-muted">{TYPE_LABELS[getValue<string>()] || getValue<string>()}</span>,
            },
            {
                accessorKey: 'severity',
                header: 'Severity',
                cell: ({ row }) => (
                    <StatusBadge variant={SEVERITY_BADGE[row.original.severity] || 'neutral'}>
                        {row.original.severity}
                    </StatusBadge>
                ),
            },
            {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => (
                    <StatusBadge variant={STATUS_BADGE[row.original.status] || 'neutral'}>
                        {STATUS_LABELS[row.original.status] || row.original.status}
                    </StatusBadge>
                ),
            },
            {
                id: 'assignee',
                header: 'Assignee',
                accessorFn: (t) => t.assignee?.name || '—',
                cell: ({ getValue }) => <span className="text-xs text-content-muted">{getValue<string>()}</span>,
            },
            {
                id: 'dueAt',
                header: 'Due Date',
                cell: ({ row }) => (
                    <TimestampTooltip
                        date={row.original.dueAt}
                        className="text-xs text-content-muted"
                    />
                ),
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                cell: ({ row }) => (
                    <TimestampTooltip
                        date={row.original.updatedAt}
                        className="text-xs text-content-muted"
                    />
                ),
            },
        );

        return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appPermissions.tasks.edit, selected, tasks.length, tenantHref, hydratedNow]);

    return (
        <ListPageShell className="animate-fadeIn gap-section" data-hydrated={hydrated || undefined}>
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: tenantHref('/dashboard') },
                                { label: 'Tasks' },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>Tasks</Heading>
                        <p className="text-sm text-content-muted mt-1">
                            Compliance work prioritised, assigned, and tracked to closure.
                        </p>
                    </div>
                    <div className="flex gap-tight">
                        <Link href={tenantHref('/tasks/dashboard')} className={buttonVariants({ variant: 'secondary', className: 'inline-flex items-center gap-tight' })} id="dashboard-btn"><AppIcon name="dashboard" size={16} /> Dashboard</Link>
                        {appPermissions.tasks.create && (
                            <Link href={tenantHref('/tasks/new')} className={buttonVariants({ variant: 'primary' })} id="new-task-btn">
                                + Task
                            </Link>
                        )}
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters>
                <FilterToolbar
                    filters={liveFilters}
                    searchId="task-search"
                    searchPlaceholder="Search tasks…"
                />
            </ListPageShell.Filters>

            {/* Bulk Actions Toolbar — flex-shrink-0 so it keeps its
                natural height in the ListPageShell column. */}
            {appPermissions.tasks.edit && selected.size > 0 && (
                <div className="glass-card p-3 flex items-center gap-compact border border-[var(--brand-default)]/30 flex-shrink-0" id="bulk-toolbar">
                    <span className="text-sm text-[var(--brand-default)] font-medium">{selected.size} selected</span>
                    <Combobox
                        hideSearch
                        id="bulk-action-select"
                        selected={BULK_ACTION_OPTIONS.find(o => o.value === bulkAction) ?? null}
                        setSelected={(opt) => { setBulkAction(opt?.value ?? ''); setBulkValue(''); }}
                        options={BULK_ACTION_OPTIONS}
                        placeholder="Choose action..."
                        matchTriggerWidth
                        buttonProps={{ className: 'w-full sm:w-40 text-sm' }}
                    />
                    {bulkAction === 'assign' && (
                        <input className="input w-full sm:w-48 text-sm" placeholder="User ID (blank = unassign)" value={bulkValue} onChange={e => setBulkValue(e.target.value)} id="bulk-value-input" />
                    )}
                    {bulkAction === 'status' && (
                        <Combobox
                            hideSearch
                            id="bulk-value-input"
                            selected={STATUS_CB_OPTIONS.find(o => o.value === bulkValue) ?? null}
                            setSelected={(opt) => setBulkValue(opt?.value ?? '')}
                            options={STATUS_CB_OPTIONS}
                            placeholder="Select status..."
                            matchTriggerWidth
                            buttonProps={{ className: 'w-full sm:w-40 text-sm' }}
                        />
                    )}
                    {bulkAction === 'due' && (
                        // Epic 58 — shared DatePicker for the bulk "Set due
                        // date" action. `bulkValue` stays a YMD string so
                        // the bulk POST body is unchanged.
                        <DatePicker
                            id="bulk-value-input"
                            className="w-full sm:w-40 text-sm"
                            placeholder="Due date"
                            clearable
                            align="start"
                            value={parseYMD(bulkValue)}
                            onChange={(next) =>
                                setBulkValue(toYMD(next) ?? '')
                            }
                            disabledDays={{
                                before: startOfUtcDay(new Date()),
                            }}
                            aria-label="Bulk due date"
                        />
                    )}
                    <Button
                        variant="primary"
                        disabled={!bulkAction || (bulkAction === 'status' && !bulkValue) || bulkMutation.isMutating}
                        onClick={handleBulkSubmit}
                        id="bulk-apply-btn"
                    >
                        {bulkMutation.isMutating ? 'Applying...' : 'Apply'}
                    </Button>
                    <button className="text-xs text-content-muted hover:text-content-emphasis" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
            )}

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                <DataTable<TaskListItem>
                    fillBody
                    data={tasks}
                    columns={taskColumns}
                    loading={loading}
                    getRowId={(t) => t.id}
                    onRowClick={(row) => router.push(tenantHref(`/tasks/${row.original.id}`))}
                    emptyState="No tasks found. Create a task to get started."
                    resourceName={(p) => p ? 'tasks' : 'task'}
                    data-testid="tasks-table"
                    className="hover:bg-bg-muted"
                />
            </ListPageShell.Body>
        </ListPageShell>
    );
}
