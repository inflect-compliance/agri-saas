'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable react-hooks/exhaustive-deps -- Various useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers/derived arrays recreated each render). The proper structural fix is wrapping parent-level callbacks in useCallback. Tracked as follow-up; existing per-line eslint-disable-next-line markers preserved. */
import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    DataTable,
    createColumns,
    useColumnsDropdown,
} from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { Modal } from '@/components/ui/modal';
import { Tooltip } from '@/components/ui/tooltip';
import {
    FilterProvider,
    filterStateToActiveFilters,
    filterStateToUrlParams,
    useFilterContext,
    useFilters,
    type ActiveFilter,
    type FilterType,
} from '@/components/ui/filter';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';
import { useKpiFilter, type KpiFilterDef } from '@/components/ui/kpi-filter';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import {
    buildControlFilters,
    CONTROL_FILTER_KEYS,
    CONTROL_STATUS_LABELS,
} from './filter-defs';
import { StatusBadge, statusBadgeClassName, type StatusBadgeVariant } from '@/components/ui/status-badge';

// ─── Constants ───

// Full ControlStatus enum — the inline-edit dropdown can set any of
// these directly (replaces the old 4-state cycle button). The cycle
// helper below keeps working for the bulk "advance status" action so
// triage flows unchanged for keyboard users who liked the rapid
// click-to-advance pattern.
const STATUS_CYCLE = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'IMPLEMENTED',
    'NEEDS_REVIEW',
] as const;
type ControlStatusType = typeof STATUS_CYCLE[number];

const ALL_STATUSES = [
    'NOT_STARTED',
    'PLANNED',
    'IN_PROGRESS',
    'IMPLEMENTING',
    'IMPLEMENTED',
    'NEEDS_REVIEW',
    'NOT_APPLICABLE',
] as const;

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

function nextStatus(current: string): ControlStatusType {
    const idx = STATUS_CYCLE.indexOf(current as ControlStatusType);
    return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

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
    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const queryClient = useQueryClient();
    const router = useRouter();

    const filterCtx = useFilters();
    const { state, search, set, toggle, remove, removeAll, clearAll, hasActive } = filterCtx;

    // Justification modal state
    const [justificationModal, setJustificationModal] = useState<{ controlId: string; code: string } | null>(null);
    const [justification, setJustification] = useState('');
    const justificationRef = useRef<HTMLTextAreaElement>(null);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const activeFilters = useMemo(
        () => filterStateToActiveFilters(state),
        [state],
    );

    // Focus justification textarea when modal opens
    useEffect(() => {
        if (justificationModal && justificationRef.current) {
            justificationRef.current.focus();
        }
    }, [justificationModal]);

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

    // ─── Mutation: applicability toggle ───

    const applicabilityMutation = useMutation({
        mutationFn: async ({ controlId, applicability, justificationText }: {
            controlId: string;
            applicability: string;
            justificationText: string | null;
        }) => {
            const res = await fetch(apiUrl(`/controls/${controlId}/applicability`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    applicability,
                    justification: applicability === 'NOT_APPLICABLE' ? justificationText : null,
                }),
            });
            if (!res.ok) throw new Error('Applicability update failed');
            return res.json();
        },
        onMutate: async ({ controlId, applicability }) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.controls.all(tenantSlug) });

            const listKey = queryKeys.controls.list(tenantSlug, queryKeyFilters);
            // PR-5 — cache value is `CappedList<ControlListItem>`.
            const previousList = queryClient.getQueryData<CappedList<ControlListItem>>(listKey);

            if (previousList) {
                queryClient.setQueryData<CappedList<ControlListItem>>(listKey, (old) =>
                    old
                        ? {
                              ...old,
                              rows: old.rows.map(c =>
                                  c.id === controlId ? { ...c, applicability } : c,
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

    // ─── Handlers ───

    const handleStatusClick = (controlId: string) => {
        const control = controls.find(c => c.id === controlId);
        if (!control || statusMutation.isPending) return;
        statusMutation.mutate({ controlId, newStatus: nextStatus(control.status) });
    };

    const handleApplicabilityClick = (controlId: string, code: string) => {
        const control = controls.find(c => c.id === controlId);
        if (!control || applicabilityMutation.isPending) return;

        if (control.applicability === 'NOT_APPLICABLE') {
            applicabilityMutation.mutate({ controlId, applicability: 'APPLICABLE', justificationText: null });
        } else {
            setJustificationModal({ controlId, code: code || controlId.slice(0, 8) });
            setJustification('');
        }
    };

    const handleJustificationSave = () => {
        if (!justificationModal || !justification.trim()) return;
        applicabilityMutation.mutate({
            controlId: justificationModal.controlId,
            applicability: 'NOT_APPLICABLE',
            justificationText: justification.trim(),
        });
        setJustificationModal(null);
        setJustification('');
    };

    const handleJustificationCancel = () => {
        setJustificationModal(null);
        setJustification('');
    };

    // ─── Helpers ───

    const taskStats = (c: ControlListItem) => {
        const total = c._count?.controlTasks ?? 0;
        // guardrail-ignore: aggregating the row's own controlTasks array.
        const done = c.controlTasks?.filter(t => t.status === 'DONE').length ?? 0;
        return { total, done };
    };

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
                // Inline-edit dropdown — replaces the legacy cycle
                // button. `<select>` keeps native a11y (label /
                // arrow-key / search-by-letter) and the existing
                // E2E `#status-pill-{id}` selector. Clicking the
                // current value still cycles via `handleStatusClick`
                // for keyboard-fast triage; explicit set goes
                // through onChange.
                if (!appPermissions.controls.edit) {
                    return (
                        <StatusBadge variant={STATUS_BADGE[c.status] || 'neutral'}>
                            {STATUS_LABELS[c.status] || c.status}
                        </StatusBadge>
                    );
                }
                return (
                    <Tooltip content="Pick a status (or click to cycle)">
                        <select
                            id={`status-pill-${c.id}`}
                            className={`${statusBadgeClassName(STATUS_BADGE[c.status] ?? 'neutral')} cursor-pointer border-0 outline-none focus:ring-2 focus:ring-[var(--brand-default)]`}
                            value={c.status}
                            onClick={(e) => {
                                // Click-to-cycle preserved for the
                                // legacy fast-triage flow; mousedown
                                // would interfere with the native
                                // `<select>` open. Cycle only fires
                                // when the click target is the select
                                // itself (not the options popup).
                                if (e.target === e.currentTarget) {
                                    e.stopPropagation();
                                }
                            }}
                            onChange={(e) => {
                                e.stopPropagation();
                                if (e.target.value !== c.status) {
                                    statusMutation.mutate({
                                        controlId: c.id,
                                        newStatus: e.target.value,
                                    });
                                }
                            }}
                            aria-label={`Status for control ${c.code || c.annexId || c.name}`}
                        >
                            {ALL_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {STATUS_LABELS[s] || s}
                                </option>
                            ))}
                        </select>
                    </Tooltip>
                );
            },
        },
        {
            accessorKey: 'applicability',
            header: 'Applicability',
            cell: ({ row }) => {
                const c = row.original;
                const code = c.code || c.annexId || '';
                if (!appPermissions.controls.edit) {
                    return (
                        <StatusBadge variant={c.applicability === 'NOT_APPLICABLE' ? 'warning' : 'success'}>
                            {c.applicability === 'NOT_APPLICABLE' ? 'N/A' : 'Yes'}
                        </StatusBadge>
                    );
                }
                return (
                    <Tooltip content="Mark applicable / not applicable">
                        <select
                            id={`applicability-pill-${c.id}`}
                            className={`${statusBadgeClassName(c.applicability === 'NOT_APPLICABLE' ? 'warning' : 'success')} cursor-pointer border-0 outline-none focus:ring-2 focus:ring-[var(--brand-default)]`}
                            value={c.applicability}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                                e.stopPropagation();
                                const next = e.target.value;
                                if (next === c.applicability) return;
                                if (next === 'NOT_APPLICABLE') {
                                    // Justification required — open
                                    // the modal (legacy flow).
                                    setJustificationModal({
                                        controlId: c.id,
                                        code: code || c.id.slice(0, 8),
                                    });
                                    setJustification('');
                                } else {
                                    applicabilityMutation.mutate({
                                        controlId: c.id,
                                        applicability: 'APPLICABLE',
                                        justificationText: null,
                                    });
                                }
                            }}
                            aria-label={`Applicability for control ${code || c.name}`}
                        >
                            <option value="APPLICABLE">Yes</option>
                            <option value="NOT_APPLICABLE">N/A</option>
                        </select>
                    </Tooltip>
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
    ]), [appPermissions, handleStatusClick, handleApplicabilityClick, tenantHref, taskStats]);

    return (
        <EntityListPage<ControlListItem>
            className="animate-fadeIn gap-section"
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
                getRowId: (c) => c.id,
                // Epic 68 — Controls page is the canonical opt-out
                // for auto-virtualization. Per product directive the
                // existing card scrolling on Controls stays as it is;
                // bespoke per-row affordances + the JS whole-row clip
                // depend on the standard <table> layout.
                virtualize: false,
                onRowClick: (row) => router.push(tenantHref(`/controls/${row.original.id}`)),
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
                // Bulk actions wired declaratively (Epic 52 contract).
                // Selection state is managed internally by DataTable
                // when batchActions are present without an explicit
                // onRowSelectionChange — keeps this page focused on
                // the action callbacks.
                batchActions: appPermissions.controls.edit
                    ? [
                          {
                              label: 'Mark Implemented',
                              icon: <CheckCircle2 className="size-3.5" />,
                              onClick: (rows) => {
                                  for (const r of rows) {
                                      statusMutation.mutate({
                                          controlId: r.original.id,
                                          newStatus: 'IMPLEMENTED',
                                      });
                                  }
                              },
                          },
                          {
                              label: 'Mark Needs Review',
                              icon: <AlertTriangle className="size-3.5" />,
                              onClick: (rows) => {
                                  for (const r of rows) {
                                      statusMutation.mutate({
                                          controlId: r.original.id,
                                          newStatus: 'NEEDS_REVIEW',
                                      });
                                  }
                              },
                          },
                          {
                              label: 'Mark Not Applicable',
                              icon: <X className="size-3.5" />,
                              variant: 'danger',
                              title: 'Bulk-set status to NOT_APPLICABLE — applicability still requires per-control justification.',
                              onClick: (rows) => {
                                  for (const r of rows) {
                                      statusMutation.mutate({
                                          controlId: r.original.id,
                                          newStatus: 'NOT_APPLICABLE',
                                      });
                                  }
                              },
                          },
                      ]
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

            {/* Justification Modal — migrated to the shared <Modal> (Epic 54) */}
            <Modal
                showModal={!!justificationModal}
                setShowModal={(v) => {
                    const next = typeof v === 'function' ? v(!!justificationModal) : v;
                    if (!next) handleJustificationCancel();
                }}
                size="sm"
                title="Mark as Not Applicable"
                description={
                    justificationModal
                        ? `Provide justification for marking control ${justificationModal.code} as not applicable.`
                        : undefined
                }
            >
                <Modal.Header
                    title="Mark as Not Applicable"
                    description={
                        justificationModal ? (
                            <>
                                Provide justification for marking control{' '}
                                <span className="font-mono text-content-emphasis">
                                    {justificationModal.code}
                                </span>{' '}
                                as not applicable.
                            </>
                        ) : null
                    }
                />
                <Modal.Body>
                    <textarea
                        ref={justificationRef}
                        className="input w-full"
                        rows={4}
                        placeholder="Justification is required..."
                        value={justification}
                        onChange={(e) => setJustification(e.target.value)}
                        id="justification-input"
                    />
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleJustificationCancel}
                        id="justification-cancel-btn"
                        text="Cancel"
                    />
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleJustificationSave}
                        disabled={!justification.trim()}
                        id="justification-save-btn"
                        text="Save"
                    />
                </Modal.Actions>
            </Modal>
        </EntityListPage>
    );
}

