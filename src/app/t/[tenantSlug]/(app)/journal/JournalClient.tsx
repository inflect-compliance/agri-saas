'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenantSWR, usePrefetchTenant } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons/nucleo';
import { Fab } from '@/components/ui/fab';
import { createColumns } from '@/components/ui/table';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
} from '@/components/ui/filter';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import {
    buildJournalFilters,
    JOURNAL_FILTER_KEYS,
    LOG_ENTRY_TYPE_LABELS,
} from './filter-defs';
import { JournalEntryModal } from './JournalEntryModal';

/** List-row shape returned by GET /journal (see JournalRepository.list). */
interface JournalRow {
    id: string;
    type: string;
    title: string;
    status: string;
    occurredAt: string;
    notes?: string | null;
    /** БАБХ cert snapshot captured on completion (operator / agronomist). */
    conditionsJson?: { operatorCertNo?: string; agronomistName?: string; agronomistCertNo?: string } | null;
    locations?: Array<{ location?: { id: string; name: string } | null }>;
    _count?: { quantities?: number; files?: number };
    /** The linked spray/operation line — the dnevnik agronomic columns (#10). */
    operationParcel?: {
        doseValue?: string | number | null;
        parcel?: { name?: string | null; cropType?: string | null; areaHa?: string | number | null } | null;
        product?: { name?: string | null; activeIngredient?: string | null; quarantinePeriodDays?: number | null } | null;
        doseUnit?: { symbol?: string | null } | null;
        task?: { operationType?: string | null; applicationTechnique?: string | null } | null;
    } | null;
}

interface JournalClientProps {
    initialEntries: JournalRow[];
    initialFilters: Record<string, string>;
    tenantSlug: string;
    permissions: { canWrite: boolean };
}

const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    PLANNED: 'info',
    DONE: 'success',
};

export function JournalClient(props: JournalClientProps) {
    const filterCtx = useFilterContext([], JOURNAL_FILTER_KEYS, {
        serverFilters: props.initialFilters,
    });
    return (
        <FilterProvider value={filterCtx}>
            <JournalPageInner {...props} />
        </FilterProvider>
    );
}

function JournalPageInner({ initialEntries, initialFilters, tenantSlug, permissions }: JournalClientProps) {
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    const prefetchData = usePrefetchTenant();
    const t = useTranslations('journal');
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const filterCtx = useFilters();
    const { state, search, hasActive } = filterCtx;
    const fetchParams = useMemo(() => toApiSearchParams(state, { search }), [state, search]);
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

    const entriesKey = useMemo(() => {
        const qs = fetchParams.toString();
        return qs ? `${CACHE_KEYS.journal.list()}?${qs}` : CACHE_KEYS.journal.list();
    }, [fetchParams]);

    const entriesQuery = useTenantSWR<JournalRow[]>(entriesKey, {
        fallbackData: filtersMatchInitial ? initialEntries : undefined,
    });
    const entries = entriesQuery.data ?? [];
    const loading = entriesQuery.isLoading && !entriesQuery.data;

    const liveFilters = useMemo(() => buildJournalFilters(), []);

    const columns = useMemo(
        () =>
            createColumns<JournalRow>([
                // Date — the regulated ДНЕВНИК leads with when the work happened.
                {
                    id: 'occurredAt',
                    header: t('colDate'),
                    accessorFn: (e) => e.occurredAt,
                    cell: ({ getValue }) => (
                        <TimestampTooltip
                            date={getValue() as string | null | undefined}
                            className="text-xs text-content-muted"
                        />
                    ),
                    meta: { disableTruncate: true, mobileCard: { slot: 'meta', label: t('colDate') } },
                },
                // Parcel / Culture — the field + its crop. Doubles as the
                // keyboard-accessible link to the entry detail. Falls back to
                // the logged location name for free-hand entries.
                {
                    id: 'parcelCulture',
                    header: t('colParcelCulture'),
                    accessorFn: (e) =>
                        e.operationParcel?.parcel?.name ??
                        e.locations?.[0]?.location?.name ??
                        e.title,
                    cell: ({ row, getValue }) => {
                        const culture = row.original.operationParcel?.parcel?.cropType;
                        return (
                            <TableTitleCell
                                href={tenantHref(`/journal/${row.original.id}`)}
                                id={`journal-link-${row.original.id}`}
                            >
                                <span>{getValue() as string}</span>
                                {culture ? (
                                    <span className="ml-1 text-xs text-content-muted">· {culture}</span>
                                ) : null}
                            </TableTitleCell>
                        );
                    },
                    meta: { mobileCard: { slot: 'title' } },
                },
                // Operation — the БАБХ operation type when present, else the
                // journal entry kind.
                {
                    id: 'operation',
                    header: t('colOperation'),
                    accessorFn: (e) =>
                        e.operationParcel?.task?.operationType ??
                        (LOG_ENTRY_TYPE_LABELS as Record<string, string>)[e.type] ??
                        String(e.type).replace(/_/g, ' '),
                    cell: ({ getValue }) => (
                        <StatusBadge variant="info" size="sm">
                            {String(getValue()).replace(/_/g, ' ')}
                        </StatusBadge>
                    ),
                    meta: { mobileCard: { slot: 'subtitle' } },
                },
                // Product + active ingredient.
                {
                    id: 'product',
                    header: t('colProduct'),
                    accessorFn: (e) => e.operationParcel?.product?.name ?? '',
                    cell: ({ row, getValue }) => {
                        const ai = row.original.operationParcel?.product?.activeIngredient;
                        const name = getValue() as string;
                        if (!name) return <span className="text-content-subtle">—</span>;
                        return (
                            <span className="text-sm">
                                {name}
                                {ai ? <span className="block text-xs text-content-muted">{ai}</span> : null}
                            </span>
                        );
                    },
                    meta: { mobileCard: { slot: 'meta', label: t('colProduct') } },
                },
                // Dose / rate.
                {
                    id: 'dose',
                    header: t('colDose'),
                    accessorFn: (e) => {
                        const op = e.operationParcel;
                        if (op?.doseValue == null) return '—';
                        return `${Number(op.doseValue)}${op.doseUnit?.symbol ? ` ${op.doseUnit.symbol}` : ''}`;
                    },
                    cell: ({ getValue }) => (
                        <span className="text-xs tabular-nums text-content-muted">{getValue() as string}</span>
                    ),
                    meta: { mobileCard: { slot: 'meta', label: t('colDose') } },
                },
                // Treated area — Parcel.areaHa in decares (дка = ha × 10), the
                // regulated Bulgarian unit.
                {
                    id: 'areaDka',
                    header: t('colTreatedArea'),
                    accessorFn: (e) => {
                        const ha = e.operationParcel?.parcel?.areaHa;
                        if (ha == null) return '—';
                        return (Number(ha) * 10).toFixed(1);
                    },
                    cell: ({ getValue }) => (
                        <span className="text-xs tabular-nums text-content-muted">{getValue() as string}</span>
                    ),
                    meta: { mobileCard: { slot: 'meta', label: t('colTreatedArea') } },
                },
                // PHI — pre-harvest interval (карантинен срок), days.
                {
                    id: 'phi',
                    header: t('colPhi'),
                    accessorFn: (e) => {
                        const d = e.operationParcel?.product?.quarantinePeriodDays;
                        return d == null ? '—' : String(d);
                    },
                    cell: ({ getValue }) => (
                        <span className="text-xs tabular-nums text-content-muted">{getValue() as string}</span>
                    ),
                    meta: { mobileCard: { slot: 'meta', label: t('colPhi') } },
                },
                // Operator — the applicator / agronomist captured on completion.
                {
                    id: 'operator',
                    header: t('colOperator'),
                    accessorFn: (e) =>
                        e.conditionsJson?.agronomistName ??
                        e.conditionsJson?.operatorCertNo ??
                        '—',
                    cell: ({ getValue }) => (
                        <span className="text-xs text-content-muted">{getValue() as string}</span>
                    ),
                    meta: { mobileCard: { slot: 'meta', label: t('colOperator') } },
                },
                // Status.
                {
                    accessorKey: 'status',
                    header: t('colStatus'),
                    cell: ({ row }) => {
                        const status = row.original.status;
                        return (
                            <StatusBadge variant={STATUS_BADGE[status] ?? 'neutral'} size="sm">
                                {status}
                            </StatusBadge>
                        );
                    },
                    meta: { mobileCard: { slot: 'status' } },
                },
                // Notes.
                {
                    id: 'notes',
                    header: t('colNotes'),
                    accessorFn: (e) => e.notes ?? '',
                    cell: ({ getValue }) => {
                        const n = getValue() as string;
                        return n ? (
                            <span className="text-xs text-content-muted">{n}</span>
                        ) : (
                            <span className="text-content-subtle">—</span>
                        );
                    },
                    meta: { mobileCard: { slot: 'meta', label: t('colNotes') } },
                },
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tenantSlug, t],
    );

    return (
        <EntityListPage<JournalRow>
            className="animate-fadeIn gap-section"
            header={{
                breadcrumbs: [
                    { label: t('dashboard'), href: tenantHref('/dashboard') },
                    { label: t('breadcrumb') },
                ],
                title: t('title'),
                description: t('description'),
                actions: permissions.canWrite ? (
                    <Button
                        variant="primary"
                        icon={<Plus className="-ml-0.5 -mr-2.5" />}
                        onClick={() => setIsCreateOpen(true)}
                        id="new-journal-btn"
                    >
                        {t('addEntry')}
                    </Button>
                ) : null,
            }}
            filters={{
                defs: liveFilters,
                searchId: 'journal-search',
                searchPlaceholder: t('searchPlaceholder'),
            }}
            table={{
                data: entries,
                columns,
                loading,
                getRowId: (e) => e.id,
                // <sm: render each entry as a tappable card; taps through to
                // the journal detail via onRowClick below.
                mobileFallback: 'card',
                onRowClick: (row) => router.push(tenantHref(`/journal/${row.original.id}`)),
                onRowPrefetch: (row) => { router.prefetch(tenantHref(`/journal/${row.original.id}`)); prefetchData(CACHE_KEYS.journal.detail(row.original.id)); },
                emptyState: hasActive ? (
                    <EmptyState
                        size="sm"
                        variant="no-results"
                        title={t('filteredEmptyTitle')}
                        description={t('filteredEmptyDescription')}
                        secondaryAction={{ label: t('clearFilters'), onClick: () => filterCtx.clearAll() }}
                    />
                ) : (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        primaryAction={
                            permissions.canWrite
                                ? { label: t('emptyAction'), onClick: () => setIsCreateOpen(true) }
                                : undefined
                        }
                    />
                ),
                resourceName: (p) => (p ? 'entries' : 'entry'),
                'data-testid': 'journal-table',
                className: 'hover:bg-bg-muted',
            }}
        >
            {permissions.canWrite && (
                <>
                    <JournalEntryModal
                        open={isCreateOpen}
                        setOpen={setIsCreateOpen}
                        tenantSlug={tenantSlug}
                        onSaved={(entry) => {
                            void entriesQuery.mutate();
                            router.push(tenantHref(`/journal/${entry.id}`));
                        }}
                    />
                    <Fab
                        onClick={() => setIsCreateOpen(true)}
                        label={t('fabLabel')}
                        icon={<Plus aria-hidden className="h-6 w-6" />}
                    />
                </>
            )}
        </EntityListPage>
    );
}
