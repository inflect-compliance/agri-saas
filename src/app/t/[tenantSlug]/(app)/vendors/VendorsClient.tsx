'use client';
/* eslint-disable react-hooks/exhaustive-deps -- Various useEffect/useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers recreated each render) or use selector functions whose change-detection happens elsewhere. Adding the deps would either trigger unnecessary re-runs OR cause infinite render loops; the proper structural fix is to wrap parent-level callbacks in useCallback. Tracked as follow-up. */
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';
import { Tooltip } from '@/components/ui/tooltip';
import { AppIcon } from '@/components/icons/AppIcon';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { NewVendorModal } from './NewVendorModal';
import { Button } from '@/components/ui/button';
import { Plus, Cube } from '@/components/ui/icons/nucleo';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { DataTable, createColumns, useColumnsDropdown, useBulkDelete } from '@/components/ui/table';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
    useFilterCardVisibility,
    filtersToCards,
    selectVisibleFilters,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { buildVendorFilters, VENDOR_FILTER_KEYS } from './filter-defs';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';
import { useKpiFilter, type KpiFilterDef } from '@/components/ui/kpi-filter';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

const STATUS_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
    ACTIVE: 'success', ONBOARDING: 'info',
    OFFBOARDING: 'warning', OFFBOARDED: 'neutral',
};
const CRIT_VARIANT: Record<string, 'neutral' | 'warning' | 'error'> = {
    LOW: 'neutral', MEDIUM: 'warning', HIGH: 'error', CRITICAL: 'error',
};

function isOverdue(d: string | null, now: Date | null) {
    if (!d || !now) return false;
    return new Date(d) < now;
}

interface VendorsClientProps {
    initialVendors: any[];
    initialFilters: Record<string, string>;
    tenantSlug: string;
    permissions: {
        canCreate: boolean;
    };
}

/**
 * Client island for vendors — handles filter interactions and table navigation.
 * Data is pre-fetched server-side and passed via props.
 */
export function VendorsClient(props: VendorsClientProps) {
    const filterCtx = useFilterContext([], VENDOR_FILTER_KEYS, {
        serverFilters: props.initialFilters,
    });
    return (
        <FilterProvider value={filterCtx}>
            <VendorsPageInner {...props} />
        </FilterProvider>
    );
}

function VendorsPageInner({ initialVendors, initialFilters, tenantSlug, permissions }: VendorsClientProps) {
    const t = useTranslations('vendors');
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    // Null until hydrated — keeps Overdue/Due badges stable across SSR.
    const hydratedNow = useHydratedNow();

    // Modal-form P2 — create-vendor modal mounted off the list, auto-
    // opening on `?create=1` (the redirect target from `/vendors/new`).
    // Bookmarks, deep links, and E2E `page.goto('/vendors/new')` all
    // land here. Flag is stripped after open so back/forward doesn't
    // reopen the modal unexpectedly.
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const searchParams = useSearchParams();
    useEffect(() => {
        if (searchParams?.get('create') === '1') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsCreateOpen(true);
            const next = new URLSearchParams(searchParams.toString());
            next.delete('create');
            const qs = next.toString();
            router.replace(
                `/t/${tenantSlug}/vendors${qs ? `?${qs}` : ''}`,
                { scroll: false },
            );
        }
        // First-mount only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    const serverHadFilters = initialFilters && Object.keys(initialFilters).length > 0;
    const filtersMatchInitial = useMemo(() => {
        if (!serverHadFilters) return !hasActive;
        const keys = new Set([...Object.keys(queryKeyFilters), ...Object.keys(initialFilters)]);
        for (const k of keys) {
            if ((queryKeyFilters[k] ?? '') !== (initialFilters[k] ?? '')) return false;
        }
        return true;
    }, [queryKeyFilters, initialFilters, serverHadFilters, hasActive]);

    // Epic 69 — same SWR-first read pattern as policies / risks /
    // evidence. Filter-aware key + server-rendered fallbackData
    // (gated against filter divergence so the hook fires fresh on
    // any URL-driven filter change).
    const vendorsKey = useMemo(() => {
        const qs = fetchParams.toString();
        return qs
            ? `${CACHE_KEYS.vendors.list()}?${qs}`
            : CACHE_KEYS.vendors.list();
    }, [fetchParams]);

    // PR-5 — API returns `{ rows, truncated }`. SSR initial wraps
    // with `truncated: false` (the SSR cap is below the backfill cap).
    const vendorsQuery = useTenantSWR<CappedList<any>>(vendorsKey, {
        fallbackData: filtersMatchInitial
            ? { rows: initialVendors, truncated: false }
            : undefined,
    });

    const vendors = vendorsQuery.data?.rows ?? [];
    const truncated = vendorsQuery.data?.truncated ?? false;

    // Bulk-delete via the table selection action-row.
    const { batchAction: vendorBulkDelete, dialog: vendorDeleteDialog } =
        useBulkDelete({
            entitySingular: 'vendor',
            entityPlural: 'vendors',
            onDelete: async (vendorIds) => {
                const res = await fetch(`/api/t/${tenantSlug}/vendors/bulk/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vendorIds }),
                });
                if (!res.ok) throw new Error('Failed to delete vendors');
                await vendorsQuery.mutate();
            },
        });
    const liveFilters = useMemo(() => buildVendorFilters(), []);
    const filterCards = useMemo(() => filtersToCards(liveFilters), [liveFilters]);
    const { visibleCards, dropdown: filtersDropdown } = useFilterCardVisibility({
        storageKey: 'inflect:filter-vis:vendors',
        cards: filterCards,
    });
    const visibleFilterDefs = useMemo(
        () => selectVisibleFilters(visibleCards, liveFilters),
        [visibleCards, liveFilters],
    );

    // ─── R23-PR-F — KPI definitions for the Vendors page ───
    type VendorKpiId = 'total' | 'active' | 'critical' | 'reviewOverdue';
    // guardrail-ignore: KPI counts across the loaded page, not a refilter.
    const totalVendors = vendors.length;
    // guardrail-ignore: KPI count, not a refilter.
    const activeVendors = vendors.filter((v: any) => v.status === 'ACTIVE').length;
    // guardrail-ignore: KPI count, not a refilter.
    const criticalVendors = vendors.filter(
        (v: any) => v.criticality === 'CRITICAL',
    ).length;
    // guardrail-ignore: KPI count, not a refilter.
    const reviewOverdueVendors = vendors.filter((v: any) =>
        isOverdue(v.nextReviewAt ?? null, hydratedNow),
    ).length;
    const vendorKpiDefs: ReadonlyArray<KpiFilterDef<VendorKpiId>> = useMemo(
        () => [
            {
                id: 'total',
                apply: (ctx) => ctx.clearAll(),
                isActive: (s) => Object.keys(s).length === 0,
            },
            {
                id: 'active',
                apply: (ctx) => ctx.set('status', 'ACTIVE'),
                isActive: (s) => (s.status ?? []).includes('ACTIVE'),
                clear: (ctx) => ctx.removeAll('status'),
            },
            {
                id: 'critical',
                apply: (ctx) => ctx.set('criticality', 'CRITICAL'),
                isActive: (s) => (s.criticality ?? []).includes('CRITICAL'),
                clear: (ctx) => ctx.removeAll('criticality'),
            },
            {
                id: 'reviewOverdue',
                apply: (ctx) => ctx.set('reviewDue', 'overdue'),
                isActive: (s) => (s.reviewDue ?? []).includes('overdue'),
                clear: (ctx) => ctx.removeAll('reviewDue'),
            },
        ],
        [],
    );
    const { activeKpiId: activeVendorKpi, toggle: toggleVendorKpi } =
        useKpiFilter(vendorKpiDefs);

    // R10-PR7 — column-visibility gear.
    const vendorColumnList = useMemo(
        () => [
            { id: 'name', label: 'Name' },
            { id: 'status', label: 'Status' },
            { id: 'criticality', label: 'Criticality' },
            { id: 'risk', label: 'Risk' },
            { id: 'nextReviewAt', label: 'Next Review' },
            { id: 'contractRenewalAt', label: 'Contract Renewal', defaultVisible: false },
            { id: 'owner', label: 'Owner' },
        ],
        [],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        orderColumns,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:vendors',
        columns: vendorColumnList,
    });

    const vendorColumns = useMemo(() => orderColumns(createColumns<any>([
        {
            accessorKey: 'name',
            header: 'Name',
            // R13-PR1 — Sub-processor badge moved out of the title
            // cell to its own column (visible via the gear). Title
            // cell stays single-element so every row in the product
            // reads at the same height.
            cell: ({ row }: any) => (
                <TableTitleCell
                    href={tenantHref(`/vendors/${row.original.id}`)}
                    id={`vendor-link-${row.original.id}`}
                >
                    {row.original.name}
                </TableTitleCell>
            ),
            meta: { mobileCard: { slot: 'title' } },
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }: any) => (
                <StatusBadge variant={STATUS_VARIANT[row.original.status] || 'neutral'} icon={null}>{row.original.status}</StatusBadge>
            ),
            meta: { mobileCard: { slot: 'status' } },
        },
        {
            accessorKey: 'criticality',
            header: 'Criticality',
            cell: ({ row }: any) => (
                <StatusBadge variant={CRIT_VARIANT[row.original.criticality] || 'neutral'} icon={null}>{row.original.criticality}</StatusBadge>
            ),
            meta: { mobileCard: { slot: 'meta' } },
        },
        {
            id: 'risk',
            header: 'Risk',
            accessorFn: (v: any) => v.inherentRisk || '',
            cell: ({ row }: any) => {
                const v = row.original;
                return v.inherentRisk
                    ? <StatusBadge variant={CRIT_VARIANT[v.inherentRisk] || 'neutral'} icon={null}>{v.inherentRisk}</StatusBadge>
                    : <span>—</span>;
            },
        },
        {
            id: 'nextReviewAt',
            header: 'Next Review',
            cell: ({ row }: any) => (
                <span>
                    <TimestampTooltip date={row.original.nextReviewAt} />
                    {isOverdue(row.original.nextReviewAt, hydratedNow) && <span className="ml-1 text-xs text-content-error font-semibold">{t('overdue')}</span>}
                </span>
            ),
            meta: { mobileCard: { slot: 'meta' } },
        },
        {
            id: 'contractRenewalAt',
            header: 'Contract Renewal',
            cell: ({ row }: any) => (
                <span>
                    <TimestampTooltip date={row.original.contractRenewalAt} />
                    {isOverdue(row.original.contractRenewalAt, hydratedNow) && <span className="ml-1 text-xs text-content-warning font-semibold">{t('due')}</span>}
                </span>
            ),
        },
        {
            id: 'owner',
            header: 'Owner',
            accessorFn: (v: any) => v.owner?.name || '—',
            cell: ({ getValue }: any) => <span className="text-content-muted">{getValue()}</span>,
            meta: { mobileCard: { slot: 'meta' } },
        },
    ])), [tenantHref, hydratedNow, orderColumns]);

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <PageBreadcrumbs
                            items={[
                                { label: t('crumbDashboard'), href: tenantHref('/dashboard') },
                                { label: t('registerCrumb') },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>{t('registerTitle')}</Heading>
                        <p className="text-sm text-content-muted mt-1">
                            {t('registerDescription')}
                        </p>
                    </div>
                    <div className="flex gap-tight">
                        <Tooltip content={t('dashboardTooltip')}>
                            <Link href={tenantHref('/vendors/dashboard')} aria-label={t('dashboardTooltip')} className={cn(buttonVariants({ variant: 'secondary', size: 'icon' }))} id="vendor-dashboard-btn">
                                <AppIcon name="dashboard" size={16} />
                            </Link>
                        </Tooltip>
                        {permissions.canCreate && (
                            <Button
                                variant="primary"
                                icon={<Plus className="-ml-0.5 -mr-2.5" />}
                                onClick={() => setIsCreateOpen(true)}
                                id="new-vendor-btn"
                            >
                                {t('newButton')}
                            </Button>
                        )}
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-section">
                {/* R23-PR-F — KPI strip. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <KpiFilterCard
                        label={t('kpi.total')}
                        value={totalVendors}
                        onClick={() => toggleVendorKpi('total')}
                        selected={activeVendorKpi === 'total'}
                    />
                    <KpiFilterCard
                        label={t('kpi.active')}
                        value={activeVendors}
                        tone="success"
                        onClick={() => toggleVendorKpi('active')}
                        selected={activeVendorKpi === 'active'}
                    />
                    <KpiFilterCard
                        label={t('kpi.critical')}
                        value={criticalVendors}
                        tone={criticalVendors > 0 ? 'critical' : 'default'}
                        onClick={() => toggleVendorKpi('critical')}
                        selected={activeVendorKpi === 'critical'}
                    />
                    <KpiFilterCard
                        label={t('kpi.reviewOverdue')}
                        value={reviewOverdueVendors}
                        tone={reviewOverdueVendors > 0 ? 'critical' : 'default'}
                        onClick={() => toggleVendorKpi('reviewOverdue')}
                        selected={activeVendorKpi === 'reviewOverdue'}
                    />
                </div>
                <FilterToolbar
                    filters={visibleFilterDefs}
                    searchId="vendors-search"
                    searchPlaceholder={t('searchPlaceholder')}
                    actions={<>{columnsDropdown}{filtersDropdown}</>}
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                {/* Outer card preserves the legacy bordered look while
                    delegating internal scroll to DataTable's fillBody. */}
                <div className="border border-border-default rounded-lg overflow-hidden md:flex md:flex-col md:flex-1 md:min-h-0">
                    <DataTable
                        fillBody
                        mobileFallback="card"
                        data={vendors}
                        columns={vendorColumns}
                        getRowId={(v: any) => v.id}
                        batchActions={permissions.canCreate ? [vendorBulkDelete] : undefined}
                        columnVisibility={columnVisibility}
                        onColumnVisibilityChange={setColumnVisibility}
                        onRowClick={(row) => router.push(tenantHref(`/vendors/${row.original.id}`))}
                        emptyState={
                            hasActive ? (
                                <EmptyState
                                    size="sm"
                                    variant="no-results"
                                    title={t('empty.noResults.title')}
                                    description={t('empty.noResults.description')}
                                    secondaryAction={{
                                        label: t('clearFilters'),
                                        onClick: () => filterCtx.clearAll(),
                                    }}
                                />
                            ) : (
                                <EmptyState
                                    size="sm"
                                    icon={Cube}
                                    variant="no-records"
                                    title={t('empty.noRecords.title')}
                                    description={t('empty.noRecords.description')}
                                />
                            )
                        }
                        resourceName={(p) => p ? 'vendors' : 'vendor'}
                        data-testid="vendors-table"
                        className="hover:bg-bg-muted"
                    />
                </div>
            </ListPageShell.Body>

            {permissions.canCreate && (
                <NewVendorModal open={isCreateOpen} setOpen={setIsCreateOpen} />
            )}
            {vendorDeleteDialog}
        </ListPageShell>
    );
}
