'use client';
/* eslint-disable react-hooks/exhaustive-deps -- Various useEffect/useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers recreated each render) or use selector functions whose change-detection happens elsewhere. Adding the deps would either trigger unnecessary re-runs OR cause infinite render loops; the proper structural fix is to wrap parent-level callbacks in useCallback. Tracked as follow-up. */
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@dub/utils';
import { DataTable, createColumns } from '@/components/ui/table';
import { Package } from 'lucide-react';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { buildVendorFilters, VENDOR_FILTER_KEYS } from './filter-defs';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

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
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    // Null until hydrated — keeps Overdue/Due badges stable across SSR.
    const hydratedNow = useHydratedNow();

    const { state, search, hasActive } = useFilters();

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
    const liveFilters = useMemo(() => buildVendorFilters(), []);

    const vendorColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }: any) => (
                <div className="font-medium">
                    <Link href={tenantHref(`/vendors/${row.original.id}`)} className="text-[var(--brand-default)] hover:underline" id={`vendor-link-${row.original.id}`} onClick={(e) => e.stopPropagation()}>
                        {row.original.name}
                    </Link>
                    {row.original.isSubprocessor && <span className="ml-2 text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Sub-processor</span>}
                </div>
            ),
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }: any) => (
                <StatusBadge variant={STATUS_VARIANT[row.original.status] || 'neutral'} icon={null}>{row.original.status}</StatusBadge>
            ),
        },
        {
            accessorKey: 'criticality',
            header: 'Criticality',
            cell: ({ row }: any) => (
                <StatusBadge variant={CRIT_VARIANT[row.original.criticality] || 'neutral'} icon={null}>{row.original.criticality}</StatusBadge>
            ),
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
                    {isOverdue(row.original.nextReviewAt, hydratedNow) && <span className="ml-1 text-xs text-content-error font-semibold">Overdue</span>}
                </span>
            ),
        },
        {
            id: 'contractRenewalAt',
            header: 'Contract Renewal',
            cell: ({ row }: any) => (
                <span>
                    <TimestampTooltip date={row.original.contractRenewalAt} />
                    {isOverdue(row.original.contractRenewalAt, hydratedNow) && <span className="ml-1 text-xs text-content-warning font-semibold">Due</span>}
                </span>
            ),
        },
        {
            id: 'owner',
            header: 'Owner',
            accessorFn: (v: any) => v.owner?.name || '—',
            cell: ({ getValue }: any) => <span className="text-content-muted">{getValue()}</span>,
        },
    ]), [tenantHref, hydratedNow]);

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: tenantHref('/dashboard') },
                                { label: 'Vendor Register' },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>Vendor Register</Heading>
                        <p className="text-content-muted text-sm">{vendors.length} vendors</p>
                    </div>
                    <div className="flex gap-tight">
                        <Link href={tenantHref('/vendors/dashboard')} className={cn(buttonVariants({ variant: 'secondary', size: 'md' }))} id="vendor-dashboard-btn">
                            Dashboard
                        </Link>
                        {permissions.canCreate && (
                            <Link href={tenantHref('/vendors/new')} className={cn(buttonVariants({ variant: 'primary', size: 'md' }))} id="new-vendor-btn">
                                + New Vendor
                            </Link>
                        )}
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters>
                <FilterToolbar
                    filters={liveFilters}
                    searchId="vendor-search"
                    searchPlaceholder="Search vendors…"
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                {/* Outer card preserves the legacy bordered look while
                    delegating internal scroll to DataTable's fillBody. */}
                <div className="border border-border-default rounded-lg overflow-hidden md:flex md:flex-col md:flex-1 md:min-h-0">
                    <DataTable
                        fillBody
                        data={vendors}
                        columns={vendorColumns}
                        getRowId={(v: any) => v.id}
                        onRowClick={(row) => router.push(tenantHref(`/vendors/${row.original.id}`))}
                        emptyState={
                            <EmptyState
                                icon={Package}
                                title={hasActive ? 'No vendors match your filters' : 'No vendors found'}
                                description={hasActive ? undefined : 'Add your first vendor to get started.'}
                            />
                        }
                        resourceName={(p) => p ? 'vendors' : 'vendor'}
                        data-testid="vendors-table"
                        className="hover:bg-bg-muted"
                    />
                </div>
            </ListPageShell.Body>
        </ListPageShell>
    );
}
