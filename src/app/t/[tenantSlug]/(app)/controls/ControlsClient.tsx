'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable react-hooks/exhaustive-deps -- Various useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers/derived arrays recreated each render). The proper structural fix is wrapping parent-level callbacks in useCallback. Tracked as follow-up; existing per-line eslint-disable-next-line markers preserved. */
import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { useRouter, useSearchParams } from 'next/navigation';
// NewControlModal and ControlDetailSheet were previously lazy-loaded
// via next/dynamic, but the JIT race in `next dev` made the modals
// occasionally fail to mount in serial-mode E2E runs (Playwright
// clicked the trigger before the chunk finished compiling). Static
// imports — the bundle cost is negligible and the E2E suite becomes
// deterministic.
import { NewControlModal } from './NewControlModal';
import { ControlDetailSheet } from './ControlDetailSheet';
import { queryKeys } from '@/lib/queryKeys';
import { AppIcon } from '@/components/icons/AppIcon';
import { Paperclip, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import {
    createColumns,
    useColumnsDropdown,
} from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import {
    FilterProvider,
    filterStateToUrlParams,
    useFilterContext,
    useFilters,
    type FilterType,
} from '@/components/ui/filter';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { AsidePanel } from '@/components/ui/aside-panel';
import { SelectionSummaryPanel } from '@/components/ui/selection-summary-panel';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';
import { useKpiFilter, type KpiFilterDef } from '@/components/ui/kpi-filter';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import {
    buildControlFilters,
    CONTROL_FILTER_KEYS,
    CONTROL_STATUS_LABELS,
} from './filter-defs';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';

// ─── Constants ───

const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    NOT_STARTED: 'neutral',
    PLANNED: 'neutral',
    IN_PROGRESS: 'info',
    IMPLEMENTING: 'info',
    IMPLEMENTED: 'success',
    NEEDS_REVIEW: 'warning',
    NOT_APPLICABLE: 'neutral',
};
/**
 * Status labels are sourced from the shared filter-defs module so the badge
 * copy and the filter picker copy cannot drift. Keep the typed
 * `CONTROL_STATUS_LABELS` as the single source of truth.
 */
const STATUS_LABELS: Record<string, string> = CONTROL_STATUS_LABELS;
const FREQ_LABELS: Record<string, string> = {
    AD_HOC: 'Ad Hoc', DAILY: 'Daily', WEEKLY: 'Weekly',
    MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually',
};

// ─── Types ───

interface ControlListItem {
    id: string;
    code: string | null;
    annexId: string | null;
    name: string;
    description: string | null;
    status: string;
    applicability: string;
    category: string | null;
    frequency: string | null;
    /** Widened to include id/email so the owner filter can resolve + display. */
    owner: { id: string; name: string | null; email: string | null } | null;
    _count?: { controlTasks?: number; evidenceLinks?: number };
    controlTasks?: Array<{ status: string }>;
}

interface ControlsClientProps {
    initialControls: ControlListItem[];
    initialFilters?: Record<string, string>;
    tenantSlug: string;
    permissions: {
        canRead: boolean;
        canWrite: boolean;
        canAdmin: boolean;
        canAudit: boolean;
        canExport: boolean;
    };
    appPermissions: {
        controls: { create: boolean; edit: boolean };
    };
}

/**
 * Client island for controls — handles filters, status cycling, applicability mutations.
 * Data arrives pre-fetched from the server component, hydrated into React Query.
 *
 * Filter architecture (Epic 53):
 *   - `useFilterContext` manages state + URL sync for everything except search.
 *   - `search` is the `q` param, owned by the same context.
 *   - Owner / Category options are derived client-side from loaded controls so
 *     the picker reflects reality without an extra API call.
 */
export function ControlsClient(props: ControlsClientProps) {
    // Build the filter context at the outer boundary so the provider can wrap
    // the inner tree — the inner component consumes via `useFilters()`.
    const filterCtx = useFilterContext(
        // Static filter defs — options are patched in inside the inner component
        // where `controls` are available. Outer uses the static shape for keys.
        [],
        CONTROL_FILTER_KEYS,
        { serverFilters: props.initialFilters },
    );

    return (
        <FilterProvider value={filterCtx}>
            <ControlsPageInner {...props} />
        </FilterProvider>
    );
}

function ControlsPageInner({
    initialControls,
    initialFilters,
    tenantSlug,
    appPermissions,
}: ControlsClientProps) {
    // Stable across renders — selection-toggle re-renders (Phase 2)
    // must NOT hand the DataTable fresh `columns` / `onRowClick` /
    // `getRowId` references, or it rebuilds the whole table model
    // mid-double-click and breaks double-click-to-navigate.
    const apiUrl = useCallback(
        (path: string) => `/api/t/${tenantSlug}${path}`,
        [tenantSlug],
    );
    const tenantHref = useCallback(
        (path: string) => `/t/${tenantSlug}${path}`,
        [tenantSlug],
    );
    const queryClient = useQueryClient();
    const router = useRouter();

    const filterCtx = useFilters();
    const { state, search, clearAll, hasActive } = filterCtx;

    // Justification modal state

    // Detail / edit Sheet state — selected control id or null for closed.
    const [sheetControlId, setSheetControlId] = useState<string | null>(null);

    // Create-control modal state. Auto-opens when the page is reached via
    // `/controls?create=1` — the `/controls/new` page redirects here so
    // deep links and E2E tests that `page.goto('/controls/new')` keep
    // working against the modal-based flow.
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const searchParams = useSearchParams();
    useEffect(() => {
        if (searchParams?.get('create') === '1') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsCreateOpen(true);
            // Strip the flag so browser back/forward doesn't re-open the
            // modal unexpectedly and so the URL stays clean after open.
            const next = new URLSearchParams(searchParams.toString());
            next.delete('create');
            const qs = next.toString();
            router.replace(`/t/${tenantSlug}/controls${qs ? `?${qs}` : ''}`, { scroll: false });
        }
        // Only run on first mount of the inner component; subsequent URL
        // edits are driven by filter state (which does its own sync).

    }, []);

    // ─── API query string from filter state + search ───
    const filtersForQuery = useMemo(() => {
        const params = filterStateToUrlParams(state);
        if (search) params.set('q', search);
        return params;
    }, [state, search]);

    // Flat shape for react-query cache key stability (objects with the same
    // serialised content should hit the same cache entry).
    const queryKeyFilters = useMemo(() => {
        const obj: Record<string, string> = {};
        for (const [k, v] of filtersForQuery) obj[k] = v;
        return obj;
    }, [filtersForQuery]);

    // ─── Query: controls list (hydrated with server data) ───

    // When server provides initialFilters, the data is already filtered server-side.
    // Only use initialData when the live filter state still matches what the server saw.
    const serverHadFilters = initialFilters && Object.keys(initialFilters).length > 0;
    const filtersMatchInitial = useMemo(() => {
        if (!serverHadFilters) return !hasActive;
        const current = queryKeyFilters;
        const keys = new Set([...Object.keys(current), ...Object.keys(initialFilters!)]);
        for (const k of keys) {
            if ((current[k] ?? '') !== (initialFilters![k] ?? '')) return false;
        }
        return true;
    }, [queryKeyFilters, initialFilters, serverHadFilters, hasActive]);

    // PR-5 — API returns `{ rows, truncated }`; SSR initial wraps
    // with `truncated: false` because the SSR cap (100) is well below
    // the backfill cap (5000), so the SSR slice never trips truncation
    // by itself.
    const controlsQuery = useQuery<CappedList<ControlListItem>>({
        queryKey: queryKeys.controls.list(tenantSlug, queryKeyFilters),
        queryFn: async () => {
            const qs = filtersForQuery.toString();
            const res = await fetch(apiUrl(`/controls${qs ? `?${qs}` : ''}`));
            if (!res.ok) throw new Error('Failed to fetch controls');
            return res.json();
        },
        initialData: filtersMatchInitial
            ? { rows: initialControls, truncated: false }
            : undefined,
        // `initialDataUpdatedAt: Date.now()` tells React Query the SSR
        // payload is "fresh as of now" so it doesn't immediately
        // refetch on hydration. The exact ms doesn't matter — only the
        // relative ordering against staleTime — so the impurity is benign.
        // eslint-disable-next-line react-hooks/purity
        initialDataUpdatedAt: filtersMatchInitial ? Date.now() : 0,
        staleTime: 30_000,
    });

    const controls = controlsQuery.data?.rows ?? [];
    const truncated = controlsQuery.data?.truncated ?? false;
    const loading = controlsQuery.isLoading && !controlsQuery.data;

    // ─── Filter defs with runtime-derived owner/category options ───
    const liveFilterDefs: FilterType[] = useMemo(
        () => buildControlFilters(controls),
        [controls],
    );

    // ─── R23-PR-D — KPI definitions for the Controls page ───
    // Status-based buckets aligned to the existing `status` filter.
    // The "In Progress" KPI buckets IN_PROGRESS + IMPLEMENTING under
    // one label visually, but the filter API sets only IN_PROGRESS;
    // pages that want a multi-status KPI extend the predicate.
    type ControlKpiId = 'total' | 'implemented' | 'inProgress' | 'notStarted';
    // guardrail-ignore: KPI counts across the loaded page, not a refilter.
    const totalControls = controls.length;
    // guardrail-ignore: KPI count, not a refilter.
    const implementedControls = controls.filter(
        (c) => c.status === 'IMPLEMENTED',
    ).length;
    // guardrail-ignore: KPI count, not a refilter.
    const inProgressControls = controls.filter(
        (c) => c.status === 'IN_PROGRESS' || c.status === 'IMPLEMENTING',
    ).length;
    // guardrail-ignore: KPI count, not a refilter.
    const notStartedControls = controls.filter(
        (c) => c.status === 'NOT_STARTED',
    ).length;
    const controlKpiDefs: ReadonlyArray<KpiFilterDef<ControlKpiId>> = useMemo(
        () => [
            {
                id: 'total',
                apply: (ctx) => ctx.clearAll(),
                isActive: (s) => Object.keys(s).length === 0,
            },
            {
                id: 'implemented',
                apply: (ctx) => ctx.set('status', 'IMPLEMENTED'),
                isActive: (s) => (s.status ?? []).includes('IMPLEMENTED'),
                clear: (ctx) => ctx.removeAll('status'),
            },
            {
                id: 'inProgress',
                apply: (ctx) => ctx.set('status', 'IN_PROGRESS'),
                isActive: (s) => (s.status ?? []).includes('IN_PROGRESS'),
                clear: (ctx) => ctx.removeAll('status'),
            },
            {
                id: 'notStarted',
                apply: (ctx) => ctx.set('status', 'NOT_STARTED'),
                isActive: (s) => (s.status ?? []).includes('NOT_STARTED'),
                clear: (ctx) => ctx.removeAll('status'),
            },
        ],
        [],
    );
    const { activeKpiId: activeControlKpi, toggle: toggleControlKpi } =
        useKpiFilter(controlKpiDefs);

    // ─── Column visibility (Epic 52 / R10-PR6) ───
    // Pagination removed — internal scroll inside the table card
    // (ListPageShell.Body + DataTable fillBody) shows all rows.
    const controlColumnList = useMemo(
        () => [
            { id: 'code', label: 'Code' },
            { id: 'name', label: 'Title' },
            { id: 'status', label: 'Status' },
            { id: 'applicability', label: 'Applicability' },
            { id: 'owner', label: 'Owner' },
            { id: 'frequency', label: 'Frequency', defaultVisible: false },
            { id: 'tasks', label: 'Tasks' },
            { id: 'evidence', label: 'Evidence' },
        ],
        [],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:controls',
        columns: controlColumnList,
    });
    // ─── Mutation: status cycle ───

    const statusMutation = useMutation({
        mutationFn: async ({ controlId, newStatus }: { controlId: string; newStatus: string }) => {
            const res = await fetch(apiUrl(`/controls/${controlId}/status`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) throw new Error('Status update failed');
            return res.json();
        },
        onMutate: async ({ controlId, newStatus }) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.controls.all(tenantSlug) });

            const listKey = queryKeys.controls.list(tenantSlug, queryKeyFilters);
            // PR-5 — cache value is `CappedList<ControlListItem>` (the API
            // returns `{ rows, truncated }`); preserve the `truncated` flag
            // and only rewrite `rows`.
            const previousList = queryClient.getQueryData<CappedList<ControlListItem>>(listKey);

            if (previousList) {
                queryClient.setQueryData<CappedList<ControlListItem>>(listKey, (old) =>
                    old
                        ? {
                              ...old,
                              rows: old.rows.map(c =>
                                  c.id === controlId ? { ...c, status: newStatus } : c,
                              ),
                          }
                        : old,
                );
            }

            return { previousList, listKey };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousList) {
                queryClient.setQueryData(context.listKey, context.previousList);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.controls.all(tenantSlug) });
        },
    });

    // ─── Row selection → selection-summary rail (right-rail Phase 2) ───
    // The page owns the selection state; DataTable is controlled via
    // `selectedRows` + `onRowSelectionChange`. When ≥1 row is selected
    // (and the viewer can edit), the `aside` slot mounts the
    // selection-summary rail with the bulk-status verbs — a calmer,
    // persistent home than the floating batch-action toolbar.
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

    // The rail is gated on the *settled* selection, not the live one.
    // DataTable's R13-PR14 click model has a single click toggle row
    // selection and a double-click navigate — so a double-click toggles
    // selection on, then off, within the double-click window. Gating
    // the rail (a layout-reflowing surface) on the live selection would
    // flash it in and then out mid-double-click, and the reflow between
    // the two physical clicks breaks double-click-to-navigate. Settling
    // the selection for 250ms before the rail reacts means a
    // double-click never trips it; a genuine single-click selection
    // (which stays put) mounts the rail a quarter-second later —
    // imperceptible.
    const [settledSelection, setSettledSelection] =
        useState<RowSelectionState>({});
    useEffect(() => {
        const t = setTimeout(() => setSettledSelection(rowSelection), 250);
        return () => clearTimeout(t);
    }, [rowSelection]);
    const selectedIds = useMemo(
        // guardrail-ignore: reads the truthy keys out of the local RowSelectionState record (selected row ids) — not server-data filtering.
        () => Object.keys(settledSelection).filter((id) => settledSelection[id]),
        [settledSelection],
    );
    const canEditControls = appPermissions.controls.edit;
    const bulkSetStatus = (newStatus: string) => {
        for (const id of selectedIds) {
            statusMutation.mutate({ controlId: id, newStatus });
        }
    };

    // Stable DataTable callbacks — see the apiUrl/tenantHref note above.
    // `handleRowClick` is the double-click→navigate handler; keeping it
    // referentially stable means a selection-toggle re-render does not
    // rebuild the table's column model.
    const handleRowClick = useCallback(
        (row: Row<ControlListItem>) =>
            router.push(tenantHref(`/controls/${row.original.id}`)),
        [router, tenantHref],
    );
    const getControlRowId = useCallback((c: ControlListItem) => c.id, []);
    const handleRowSelectionChange = useCallback(
        (rows: Row<ControlListItem>[]) =>
            setRowSelection(
                Object.fromEntries(rows.map((r) => [r.id, true])),
            ),
        [],
    );

    // ─── Helpers ───

    const taskStats = useCallback((c: ControlListItem) => {
        const total = c._count?.controlTasks ?? 0;
        // guardrail-ignore: aggregating the row's own controlTasks array.
        const done = c.controlTasks?.filter(t => t.status === 'DONE').length ?? 0;
        return { total, done };
    }, []);

    // ── Column definitions ──
    const controlColumns = useMemo(() => createColumns<ControlListItem>([
        {
            accessorFn: (c) => c.code || c.annexId || '',
            id: 'code',
            header: 'Code',
            cell: ({ getValue }) => (
                <span className="text-xs text-content-muted font-mono">{getValue<string>() || '—'}</span>
            ),
        },
        {
            accessorKey: 'name',
            header: 'Title',
            cell: ({ row }) => (
                <TableTitleCell
                    href={tenantHref(`/controls/${row.original.id}`)}
                    id={`control-link-${row.original.id}`}
                >
                    {row.original.name}
                </TableTitleCell>
            ),
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }) => {
                const c = row.original;
                // 2026-05-19 — inline-edit dropdown retired. The
                // cell is now a read-only badge; status changes
                // route through the per-control detail page (Edit
                // Control sheet) or the bulk-set toolbar actions
                // (Mark Implemented / Needs Review / Not Applicable).
                // Keeping the well-known `#status-pill-{id}` id on
                // the badge so existing E2E selectors stay valid.
                return (
                    <StatusBadge
                        id={`status-pill-${c.id}`}
                        variant={STATUS_BADGE[c.status] || 'neutral'}
                    >
                        {STATUS_LABELS[c.status] || c.status}
                    </StatusBadge>
                );
            },
        },
        {
            accessorKey: 'applicability',
            header: 'Applicability',
            cell: ({ row }) => {
                const c = row.original;
                // 2026-05-19 — inline-edit dropdown retired alongside
                // Status (see comment above). Applicability changes
                // route through the per-control detail page; the
                // justification modal is preserved there. Selector
                // id `#applicability-pill-{id}` kept for E2E parity.
                return (
                    <StatusBadge
                        id={`applicability-pill-${c.id}`}
                        variant={c.applicability === 'NOT_APPLICABLE' ? 'warning' : 'success'}
                    >
                        {c.applicability === 'NOT_APPLICABLE' ? 'N/A' : 'Yes'}
                    </StatusBadge>
                );
            },
        },
        {
            id: 'owner',
            header: 'Owner',
            accessorFn: (c) => c.owner?.name || c.owner?.email || '—',
            cell: ({ row }) => {
                const c = row.original;
                if (!c.owner) {
                    return <span className="text-xs text-content-subtle">—</span>;
                }
                const display = c.owner.name ?? c.owner.email ?? '?';
                const initial = display.charAt(0).toUpperCase();
                return (
                    <span
                        className="inline-flex items-center gap-1.5"
                        data-testid={`control-owner-${c.id}`}
                    >
                        <span
                            aria-hidden
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-[10px] font-medium text-content-emphasis"
                        >
                            {initial}
                        </span>
                        <span className="min-w-0 leading-tight">
                            <span className="block truncate text-xs text-content-emphasis">
                                {c.owner.name ?? c.owner.email}
                            </span>
                            {c.owner.name && c.owner.email && (
                                <span className="block truncate text-[10px] text-content-subtle">
                                    {c.owner.email}
                                </span>
                            )}
                        </span>
                    </span>
                );
            },
        },
        {
            id: 'frequency',
            header: 'Frequency',
            accessorFn: (c) => c.frequency ? FREQ_LABELS[c.frequency] || c.frequency : '—',
            cell: ({ getValue }) => (
                <span className="text-xs text-content-muted">{getValue<string>()}</span>
            ),
        },
        {
            id: 'tasks',
            header: 'Tasks',
            accessorFn: (c) => {
                const ts = taskStats(c);
                return `${ts.done}/${ts.total}`;
            },
            cell: ({ row }) => {
                const ts = taskStats(row.original);
                return (
                    <span className={ts.total > 0 && ts.done === ts.total ? 'text-content-success text-xs' : 'text-content-muted text-xs'}>
                        {ts.done}/{ts.total}
                    </span>
                );
            },
        },
        {
            id: 'evidence',
            header: 'Evidence',
            accessorFn: (c) => c._count?.evidenceLinks ?? 0,
            cell: ({ getValue, row }) => {
                const n = getValue<number>();
                return (
                    <span
                        className={`inline-flex items-center gap-1 text-xs ${n > 0 ? 'text-content-emphasis' : 'text-content-subtle'}`}
                        data-testid={`control-evidence-${row.original.id}`}
                    >
                        <Paperclip
                            size={12}
                            className={n > 0 ? 'text-content-success' : 'text-content-subtle'}
                            aria-hidden
                        />
                        {n}
                    </span>
                );
            },
        },
        {
            id: 'quick-edit',
            header: '',
            enableHiding: false,
            cell: ({ row }) => (
                appPermissions.controls.edit ? (
                    <button
                        type="button"
                        aria-label="Open control detail sheet"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid={`control-quick-edit-${row.original.id}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setSheetControlId(row.original.id);
                        }}
                    >
                        <AppIcon name="edit" size={14} />
                    </button>
                ) : null
            ),
        },
    ]), [appPermissions, tenantHref, taskStats]);

    // Selection-summary rail — mounted only when the viewer can edit
    // AND ≥1 row is selected. `<AsidePanel>` owns the collapse chrome +
    // the `<Sheet>` fallback below xl; `<SelectionSummaryPanel>` is the
    // content. Absent ⇒ the list page is single-column, unchanged.
    const selectionAside =
        canEditControls && selectedIds.length > 0 ? (
            <AsidePanel
                title="Selection"
                surfaceKey="controls-list"
                icon={<AppIcon name="controls" size={16} />}
            >
                <SelectionSummaryPanel
                    count={selectedIds.length}
                    resourceLabel={{ singular: 'control', plural: 'controls' }}
                    onClear={() => setRowSelection({})}
                    actions={[
                        {
                            label: 'Mark Implemented',
                            icon: <CheckCircle2 className="size-3.5" />,
                            onClick: () => bulkSetStatus('IMPLEMENTED'),
                        },
                        {
                            label: 'Mark Needs Review',
                            icon: <AlertTriangle className="size-3.5" />,
                            onClick: () => bulkSetStatus('NEEDS_REVIEW'),
                        },
                        {
                            label: 'Mark Not Applicable',
                            icon: <X className="size-3.5" />,
                            tone: 'danger',
                            onClick: () => bulkSetStatus('NOT_APPLICABLE'),
                        },
                    ]}
                />
            </AsidePanel>
        ) : undefined;

    return (
        <EntityListPage<ControlListItem>
            className="animate-fadeIn gap-section"
            aside={selectionAside}
            banner={<TruncationBanner truncated={truncated} />}
            header={{
                breadcrumbs: [
                    // Was `tenantHref('/')` — that resolves to `/t/<slug>/`
                    // which has no page.tsx and 404s. Next.js auto-prefetches
                    // every visible <Link>, so the failing prefetch kept the
                    // page in a perpetual "fetch in flight" state and made
                    // `waitForLoadState('networkidle')` hang for the full
                    // 180s test timeout in every Playwright spec on this
                    // page (create-control-modal, controls-filter-epic53,
                    // control-edit-modal, controls-enhanced).
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: 'Controls' },
                ],
                title: (
                    <>
                        <AppIcon name="controls" className="inline-block mr-2 align-text-bottom" />
                        {' '}
                        Controls
                    </>
                ),
                // Roadmap-2 PR-4 + PR-11 — editorial framing
                // replaces the count chip. Pages still surface
                // the count in the table body (DataTable shows
                // row count); the header line carries the
                // editorial intent.
                description:
                    'Every control mapped to its requirements and evidence.',
                actions: (
                    <>
                        {/* Sankey is read-only and informational — keep it
                            outside the create-permission gate so READERs
                            can still glance at the asset → risk → control
                            flow. */}
                        <Link href={tenantHref('/controls/sankey')} className={buttonVariants({ variant: 'secondary', size: 'sm' })} id="controls-sankey-btn">
                            <AppIcon name="share" size={14} /> Sankey
                        </Link>
                        {appPermissions.controls.create && (
                            <>
                                <Link href={tenantHref('/controls/dashboard')} className={buttonVariants({ variant: 'secondary', size: 'sm' })} id="controls-dashboard-btn">
                                    <AppIcon name="dashboard" size={14} /> Dashboard
                                </Link>
                                <Link href={tenantHref('/frameworks')} className={buttonVariants({ variant: 'secondary', size: 'sm' })} id="frameworks-btn">
                                    <AppIcon name="frameworks" size={14} /> Frameworks
                                </Link>
                                <Link href={tenantHref('/controls/templates')} className={buttonVariants({ variant: 'secondary', size: 'sm' })} id="install-templates-btn">
                                    <AppIcon name="templates" size={14} /> Install from Templates
                                </Link>
                                <Button
                                    variant="primary"
                                    id="new-control-btn"
                                    onClick={() => setIsCreateOpen(true)}
                                >
                                    + Control
                                </Button>
                            </>
                        )}
                    </>
                ),
            }}
            kpis={
                /* R23-PR-D — KPI strip above the filter toolbar.
                   EntityListPage owns the placement; the page owns
                   the KPI definitions + the card content. */
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <KpiFilterCard
                        label="Total controls"
                        value={totalControls}
                        onClick={() => toggleControlKpi('total')}
                        selected={activeControlKpi === 'total'}
                    />
                    <KpiFilterCard
                        label="Implemented"
                        value={implementedControls}
                        tone="success"
                        onClick={() => toggleControlKpi('implemented')}
                        selected={activeControlKpi === 'implemented'}
                    />
                    <KpiFilterCard
                        label="In progress"
                        value={inProgressControls}
                        tone="attention"
                        onClick={() => toggleControlKpi('inProgress')}
                        selected={activeControlKpi === 'inProgress'}
                    />
                    <KpiFilterCard
                        label="Not started"
                        value={notStartedControls}
                        tone={notStartedControls > 0 ? 'critical' : 'default'}
                        onClick={() => toggleControlKpi('notStarted')}
                        selected={activeControlKpi === 'notStarted'}
                    />
                </div>
            }
            filters={{
                defs: liveFilterDefs,
                toolbarActions: columnsDropdown,
            }}
            table={{
                data: controls,
                columns: controlColumns,
                loading,
                getRowId: getControlRowId,
                // Epic 68 — Controls page is the canonical opt-out
                // for auto-virtualization. Per product directive the
                // existing card scrolling on Controls stays as it is;
                // bespoke per-row affordances + the JS whole-row clip
                // depend on the standard <table> layout.
                virtualize: false,
                onRowClick: handleRowClick,
                emptyState: hasActive ? (
                    <EmptyState
                        size="sm"
                        variant="no-results"
                        title="No controls match your filters"
                        description="Try widening your search or clearing one of the active filters."
                        secondaryAction={{
                            label: 'Clear filters',
                            onClick: () => clearAll(),
                        }}
                    />
                ) : (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title="No controls yet"
                        description="Start with a pre-built framework or define your own control."
                        primaryAction={{
                            label: 'Install templates',
                            href: tenantHref('/controls/templates'),
                        }}
                        secondaryAction={{
                            label: 'Create control',
                            onClick: () => setIsCreateOpen(true),
                        }}
                    />
                ),
                resourceName: (p) => (p ? 'controls' : 'control'),
                columnVisibility,
                onColumnVisibilityChange: setColumnVisibility,
                'data-testid': 'controls-table',
                className: 'hover:bg-bg-muted',
                // Right-rail Phase 2 — selection is page-controlled so
                // the selection-summary rail can render the bulk-status
                // verbs (see `selectionAside` above). The floating
                // batch-action toolbar (`batchActions`) is retired here
                // in favour of the rail. For viewers without edit
                // permission, selection is left off entirely — no
                // checkboxes, no rail — exactly the prior behaviour.
                selectedRows: canEditControls ? rowSelection : undefined,
                onRowSelectionChange: canEditControls
                    ? handleRowSelectionChange
                    : undefined,
            }}
        >
            {/* Create Control Modal (Epic 54) */}
            <NewControlModal
                open={isCreateOpen}
                setOpen={setIsCreateOpen}
                tenantSlug={tenantSlug}
            />

            {/* Control Detail / Edit Sheet (Epic 54) */}
            <ControlDetailSheet
                controlId={sheetControlId}
                setControlId={setSheetControlId}
                tenantSlug={tenantSlug}
                apiUrl={apiUrl}
                tenantHref={tenantHref}
                canWrite={appPermissions.controls.edit}
            />

        </EntityListPage>
    );
}

