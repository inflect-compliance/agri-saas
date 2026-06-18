'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons/nucleo';
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
    locations?: Array<{ location?: { id: string; name: string } | null }>;
    _count?: { quantities?: number; files?: number };
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
                {
                    accessorKey: 'type',
                    header: 'Type',
                    cell: ({ row }) => (
                        <StatusBadge variant="info" size="sm">
                            {(LOG_ENTRY_TYPE_LABELS as Record<string, string>)[row.original.type] ??
                                String(row.original.type).replace(/_/g, ' ')}
                        </StatusBadge>
                    ),
                    // Mobile card secondary line — the entry kind (pill).
                    meta: { mobileCard: { slot: 'subtitle' } },
                },
                {
                    accessorKey: 'title',
                    header: 'Title',
                    cell: ({ row, getValue }) => (
                        <TableTitleCell
                            href={tenantHref(`/journal/${row.original.id}`)}
                            id={`journal-link-${row.original.id}`}
                        >
                            {getValue() as string}
                        </TableTitleCell>
                    ),
                    // Mobile (<sm) card heading. The cell's link points to the
                    // SAME detail route the card taps through to.
                    meta: { mobileCard: { slot: 'title' } },
                },
                {
                    id: 'occurredAt',
                    header: 'Date',
                    accessorFn: (e) => e.occurredAt,
                    cell: ({ getValue }) => (
                        <TimestampTooltip
                            date={getValue() as string | null | undefined}
                            className="text-xs text-content-muted"
                        />
                    ),
                    // Mobile card key/value row — when the work happened.
                    meta: { disableTruncate: true, mobileCard: { slot: 'meta', label: 'Date' } },
                },
                {
                    accessorKey: 'status',
                    header: 'Status',
                    cell: ({ row }) => {
                        const status = row.original.status;
                        return (
                            <StatusBadge variant={STATUS_BADGE[status] ?? 'neutral'} size="sm">
                                {status}
                            </StatusBadge>
                        );
                    },
                    // Mobile card status pill (top-right).
                    meta: { mobileCard: { slot: 'status' } },
                },
                {
                    id: 'location',
                    header: 'Location',
                    accessorFn: (e) => {
                        const locs = e.locations ?? [];
                        const first = locs[0]?.location?.name;
                        if (!first) return '—';
                        return locs.length > 1 ? `${first} +${locs.length - 1}` : first;
                    },
                    cell: ({ getValue }) => (
                        <span className="text-xs text-content-muted">{getValue() as string}</span>
                    ),
                    // Mobile card key/value row — the field/block.
                    meta: { mobileCard: { slot: 'meta', label: 'Location' } },
                },
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tenantSlug],
    );

    return (
        <EntityListPage<JournalRow>
            className="animate-fadeIn gap-section"
            header={{
                breadcrumbs: [
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: 'Journal' },
                ],
                title: 'Field Journal',
                description: 'The durable record of work done — and planned — on the farm.',
                actions: permissions.canWrite ? (
                    <Button
                        variant="primary"
                        icon={<Plus className="-ml-0.5 -mr-2.5" />}
                        onClick={() => setIsCreateOpen(true)}
                        id="new-journal-btn"
                    >
                        Entry
                    </Button>
                ) : null,
            }}
            filters={{
                defs: liveFilters,
                searchId: 'journal-search',
                searchPlaceholder: 'Search entries…',
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
                emptyState: hasActive ? (
                    <EmptyState
                        size="sm"
                        variant="no-results"
                        title="No entries match your filters"
                        description="Try widening your search or clearing one of the active filters."
                        secondaryAction={{ label: 'Clear filters', onClick: () => filterCtx.clearAll() }}
                    />
                ) : (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title="No journal entries yet"
                        description="Log field activities, observations, input applications, and harvests — the field record behind every traceability claim."
                        primaryAction={
                            permissions.canWrite
                                ? { label: 'Add entry', onClick: () => setIsCreateOpen(true) }
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
                <JournalEntryModal
                    open={isCreateOpen}
                    setOpen={setIsCreateOpen}
                    tenantSlug={tenantSlug}
                    onSaved={(entry) => {
                        void entriesQuery.mutate();
                        router.push(tenantHref(`/journal/${entry.id}`));
                    }}
                />
            )}
        </EntityListPage>
    );
}
