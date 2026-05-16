'use client';
/* eslint-disable react-hooks/exhaustive-deps -- Various useEffect/useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers recreated each render) or use selector functions whose change-detection happens elsewhere. Adding the deps would either trigger unnecessary re-runs OR cause infinite render loops; the proper structural fix is to wrap parent-level callbacks in useCallback. Tracked as follow-up. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Server payload is loosely typed at the page boundary; per-cell TanStack column callbacks need a per-row narrowing pass to remove the `any`s, tracked as follow-up. */
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import {
    createColumns,
    useColumnsDropdown,
} from '@/components/ui/table';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
} from '@/components/ui/filter';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';
import { useKpiFilter, type KpiFilterDef } from '@/components/ui/kpi-filter';
import { buttonVariants } from '@/components/ui/button-variants';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import {
    buildPolicyFilters,
    POLICY_FILTER_KEYS,
    POLICY_STATUS_LABELS,
} from './filter-defs';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';

// Status badge classes — keyed off the canonical PolicyStatus enum
// values. POLICY_STATUS_LABELS in `filter-defs.ts` is the single
// source of truth for the human label; this map covers the visual
// treatment per state.
const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    DRAFT: 'neutral',
    IN_REVIEW: 'info',
    APPROVED: 'success',
    PUBLISHED: 'success',
    ARCHIVED: 'warning',
};

interface PoliciesClientProps {
    initialPolicies: any[];
    initialFilters?: Record<string, string>;
    tenantSlug: string;
    permissions: {
        canRead: boolean;
        canWrite: boolean;
        canAdmin: boolean;
        canAudit: boolean;
        canExport: boolean;
    };
    translations: {
        title: string;
        listDescription: string;
    };
}

/**
 * Client island for policies — handles filters, search, and the
 * interactive list. Data arrives pre-fetched from the server
 * component, hydrated into React Query.
 *
 * Epic 45.1 — page sits on the unified `<EntityListPage>` shell
 * (Epic 91) so the layout chrome (header, filters, body, modals
 * passthrough) stays consistent with controls + risks.
 */
export function PoliciesClient(props: PoliciesClientProps) {
    const filterCtx = useFilterContext([], POLICY_FILTER_KEYS, {
        serverFilters: props.initialFilters,
    });
    return (
        <FilterProvider value={filterCtx}>
            <PoliciesPageInner {...props} />
        </FilterProvider>
    );
}

function PoliciesPageInner({
    initialPolicies,
    initialFilters,
    tenantSlug,
    permissions,
    translations: t,
}: PoliciesClientProps) {
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    // Null on SSR + first client render so the "Overdue" badge doesn't
    // flip between server- and client-side `new Date()` values.
    const hydratedNow = useHydratedNow();

    const filterCtx = useFilters();
    const { state, search, hasActive } = filterCtx;
    const fetchParams = useMemo(
        () => toApiSearchParams(state, { search }),
        [state, search],
    );
    const queryKeyFilters = useMemo(() => {
        const obj: Record<string, string> = {};
        for (const [k, v] of fetchParams) obj[k] = v;
        return obj;
    }, [fetchParams]);

    const serverHadFilters =
        initialFilters && Object.keys(initialFilters).length > 0;
    const filtersMatchInitial = useMemo(() => {
        if (!serverHadFilters) return !hasActive;
        const keys = new Set([
            ...Object.keys(queryKeyFilters),
            ...Object.keys(initialFilters!),
        ]);
        for (const k of keys) {
            if ((queryKeyFilters[k] ?? '') !== (initialFilters![k] ?? '')) {
                return false;
            }
        }
        return true;
    }, [queryKeyFilters, initialFilters, serverHadFilters, hasActive]);

    // Epic 69 — read source is `useTenantSWR` against a filter-aware
    // cache key. Each filter combination becomes its own cache entry
    // (the qs-suffix on the path keeps them isolated). Server-rendered
    // `initialPolicies` lands as `fallbackData` only when the active
    // filters match the server view — otherwise the hook fires a
    // fresh request immediately, mirroring the prior React Query
    // "skip initialData when filters diverge" semantics.
    const policiesKey = useMemo(() => {
        const qs = fetchParams.toString();
        return qs
            ? `${CACHE_KEYS.policies.list()}?${qs}`
            : CACHE_KEYS.policies.list();
    }, [fetchParams]);

    // PR-5 — API returns `{ rows, truncated }`. SSR initial wraps
    // with `truncated: false` (the SSR cap is below the backfill cap).
    const policiesQuery = useTenantSWR<CappedList<any>>(policiesKey, {
        fallbackData: filtersMatchInitial
            ? { rows: initialPolicies, truncated: false }
            : undefined,
    });

    const policies = policiesQuery.data?.rows ?? [];
    const truncated = policiesQuery.data?.truncated ?? false;
    const loading = policiesQuery.isLoading && !policiesQuery.data;

    const liveFilters = useMemo(
        () => buildPolicyFilters(policies),
        [policies],
    );

    // ─── R23-PR-F — KPI definitions for the Policies page ───
    type PolicyKpiId = 'total' | 'draft' | 'inReview' | 'approved';
    // guardrail-ignore: KPI counts across the loaded page, not a refilter.
    const totalPolicies = policies.length;
    // guardrail-ignore: KPI count, not a refilter.
    const draftPolicies = policies.filter((p: any) => p.status === 'DRAFT').length;
    // guardrail-ignore: KPI count, not a refilter.
    const inReviewPolicies = policies.filter((p: any) => p.status === 'IN_REVIEW').length;
    // guardrail-ignore: KPI count, not a refilter.
    const approvedPolicies = policies.filter(
        (p: any) => p.status === 'APPROVED' || p.status === 'PUBLISHED',
    ).length;
    const policyKpiDefs: ReadonlyArray<KpiFilterDef<PolicyKpiId>> = useMemo(
        () => [
            {
                id: 'total',
                apply: (ctx) => ctx.clearAll(),
                isActive: (s) => Object.keys(s).length === 0,
            },
            {
                id: 'draft',
                apply: (ctx) => ctx.set('status', 'DRAFT'),
                isActive: (s) => (s.status ?? []).includes('DRAFT'),
                clear: (ctx) => ctx.removeAll('status'),
            },
            {
                id: 'inReview',
                apply: (ctx) => ctx.set('status', 'IN_REVIEW'),
                isActive: (s) => (s.status ?? []).includes('IN_REVIEW'),
                clear: (ctx) => ctx.removeAll('status'),
            },
            {
                id: 'approved',
                apply: (ctx) => ctx.set('status', 'APPROVED'),
                isActive: (s) => (s.status ?? []).includes('APPROVED'),
                clear: (ctx) => ctx.removeAll('status'),
            },
        ],
        [],
    );
    const { activeKpiId: activePolicyKpi, toggle: togglePolicyKpi } =
        useKpiFilter(policyKpiDefs);

    // ─── Column visibility (Epic 52 / R10-PR6) ───
    const policyColumnList = useMemo(
        () => [
            { id: 'title', label: 'Title' },
            { id: 'status', label: 'Status' },
            { id: 'category', label: 'Category' },
            { id: 'owner', label: 'Owner' },
            { id: 'version', label: 'Version' },
            { id: 'nextReviewAt', label: 'Next Review' },
            { id: 'updatedAt', label: 'Updated' },
        ],
        [],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:policies',
        columns: policyColumnList,
    });

    const policyColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: 'Title',
            // R12-PR2 — drop the block-level <p> description that
            // pushed rows to 60+px. Title cell stays single-line so
            // every row across the product reads at the same
            // ~44px height (the DataTable primitive's `py-2.5
            // leading-6` baseline). Description is still visible on
            // the policy detail page.
            cell: ({ row }: any) => (
                <TableTitleCell
                    href={tenantHref(`/policies/${row.original.id}`)}
                >
                    {row.original.title}
                </TableTitleCell>
            ),
        },
        {
            accessorKey: 'status',
            header: 'Status',
            // Pulls labels from the canonical POLICY_STATUS_LABELS so
            // the badge copy and the filter copy cannot drift.
            cell: ({ row }: any) => {
                const status = row.original.status as string;
                const cls = STATUS_BADGE[status] ?? 'neutral';
                const label =
                    (POLICY_STATUS_LABELS as Record<string, string>)[status] ??
                    status;
                return (
                    <StatusBadge variant={cls} data-testid={`policy-status-${row.original.id}`}>
                        {label}
                    </StatusBadge>
                );
            },
        },
        {
            id: 'category',
            header: 'Category',
            accessorFn: (p: any) => p.category || '—',
            cell: ({ getValue }: any) => (
                <span className="text-xs text-content-muted">{getValue()}</span>
            ),
        },
        {
            id: 'owner',
            header: 'Owner',
            // Avatar chip — same pattern landed for controls in the
            // recent UX-polish PR. Falls back to em-dash when no
            // ownerUser is set on the policy.
            accessorFn: (p: any) =>
                p.owner?.name || p.owner?.email || '—',
            cell: ({ row }: any) => {
                const p = row.original;
                if (!p.owner) {
                    return (
                        <span className="text-xs text-content-subtle">—</span>
                    );
                }
                const display = p.owner.name ?? p.owner.email ?? '?';
                const initial = display.charAt(0).toUpperCase();
                return (
                    <span
                        className="inline-flex items-center gap-1.5"
                        data-testid={`policy-owner-${p.id}`}
                    >
                        <span
                            aria-hidden
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-[10px] font-medium text-content-emphasis"
                        >
                            {initial}
                        </span>
                        <span className="min-w-0 leading-tight">
                            <span className="block truncate text-xs text-content-emphasis">
                                {p.owner.name ?? p.owner.email}
                            </span>
                            {p.owner.name && p.owner.email && (
                                <span className="block truncate text-[10px] text-content-subtle">
                                    {p.owner.email}
                                </span>
                            )}
                        </span>
                    </span>
                );
            },
        },
        {
            id: 'version',
            header: 'Version',
            // Prefer the bound `currentVersion.versionNumber` (the
            // operator-visible counter that ratchets only on
            // publish). Falls back to `lifecycleVersion` (which
            // matches CISO-Assistant's editing_version) and finally
            // a dash for policies without any version row yet.
            accessorFn: (p: any) =>
                p.currentVersion?.versionNumber ??
                p.lifecycleVersion ??
                null,
            cell: ({ getValue, row }: any) => {
                const v = getValue();
                if (v == null) {
                    return (
                        <span className="text-xs text-content-subtle">—</span>
                    );
                }
                return (
                    <span
                        className="inline-flex items-center rounded-md bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-content-emphasis"
                        data-testid={`policy-version-${row.original.id}`}
                    >
                        v{v}
                    </span>
                );
            },
        },
        {
            id: 'nextReviewAt',
            header: 'Next Review',
            accessorFn: (p: any) => p.nextReviewAt || '',
            cell: ({ row }: any) => {
                const p = row.original;
                if (!p.nextReviewAt) {
                    return <span className="text-xs text-content-muted">—</span>;
                }
                const isOverdue =
                    !!hydratedNow &&
                    new Date(p.nextReviewAt) < hydratedNow &&
                    p.status !== 'ARCHIVED';
                return (
                    <span className="inline-flex items-center gap-1 text-xs text-content-muted">
                        <TimestampTooltip date={p.nextReviewAt} />
                        {isOverdue && (
                            <StatusBadge variant="error" data-testid={`policy-overdue-${p.id}`}>
                                Overdue
                            </StatusBadge>
                        )}
                    </span>
                );
            },
            meta: { disableTruncate: true },
        },
        {
            id: 'updatedAt',
            header: 'Updated',
            accessorFn: (p: any) => p.updatedAt,
            cell: ({ getValue }: any) => (
                <TimestampTooltip
                    date={getValue() as string | null | undefined}
                    className="text-xs text-content-subtle"
                />
            ),
        },
    ]), [tenantHref, hydratedNow]);

    return (
        <EntityListPage<any>
            className="animate-fadeIn gap-section"
            banner={<TruncationBanner truncated={truncated} />}
            header={{
                breadcrumbs: [
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: t.title },
                ],
                title: t.title,
                // Roadmap-2 PR-4 — editorial framing.
                description: t.listDescription,
                actions: permissions.canWrite ? (
                    <>
                        <Link
                            href={tenantHref('/policies/templates')}
                            className={buttonVariants({ variant: 'secondary' })}
                            id="policy-from-template-btn"
                        >
                            From Template
                        </Link>
                        <Link
                            href={tenantHref('/policies/new')}
                            className={buttonVariants({ variant: 'primary' })}
                            id="new-policy-btn"
                        >
                            + Policy
                        </Link>
                    </>
                ) : null,
            }}
            kpis={
                /* R23-PR-F — KPI strip rendered via EntityListPage's
                   kpis slot (added in R23-PR-D). */
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <KpiFilterCard
                        label="Total policies"
                        value={totalPolicies}
                        onClick={() => togglePolicyKpi('total')}
                        selected={activePolicyKpi === 'total'}
                    />
                    <KpiFilterCard
                        label="Draft"
                        value={draftPolicies}
                        tone="attention"
                        onClick={() => togglePolicyKpi('draft')}
                        selected={activePolicyKpi === 'draft'}
                    />
                    <KpiFilterCard
                        label="In review"
                        value={inReviewPolicies}
                        tone="default"
                        onClick={() => togglePolicyKpi('inReview')}
                        selected={activePolicyKpi === 'inReview'}
                    />
                    <KpiFilterCard
                        label="Approved"
                        value={approvedPolicies}
                        tone="success"
                        onClick={() => togglePolicyKpi('approved')}
                        selected={activePolicyKpi === 'approved'}
                    />
                </div>
            }
            filters={{
                defs: liveFilters,
                toolbarActions: columnsDropdown,
            }}
            table={{
                data: policies,
                columns: policyColumns,
                loading,
                getRowId: (p: any) => p.id,
                onRowClick: (row) =>
                    router.push(tenantHref(`/policies/${row.original.id}`)),
                emptyState: hasActive ? (
                    <EmptyState
                        size="sm"
                        variant="no-results"
                        title="No policies match your filters"
                        description="Try widening your search or clearing one of the active filters."
                        secondaryAction={{
                            label: 'Clear filters',
                            onClick: () => filterCtx.clearAll(),
                        }}
                    />
                ) : (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title="No policies yet"
                        description="Author the documents that govern how your organisation operates — security, privacy, acceptable use, incident response."
                    />
                ),
                resourceName: (p) => (p ? 'policies' : 'policy'),
                columnVisibility,
                onColumnVisibilityChange: setColumnVisibility,
                'data-testid': 'policies-table',
                className: 'hover:bg-bg-muted',
            }}
        />
    );
}
