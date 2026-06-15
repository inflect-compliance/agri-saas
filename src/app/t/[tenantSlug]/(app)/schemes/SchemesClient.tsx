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
import { NewSchemeModal } from './NewSchemeModal';

/** List-row shape returned by GET /schemes (a global AG_SCHEME framework). */
export interface SchemeRow {
    id: string;
    key: string;
    name: string;
    description: string | null;
    _count?: { requirements?: number; packs?: number };
}

interface SchemesClientProps {
    initialSchemes: SchemeRow[];
    tenantSlug: string;
    permissions: { canAdmin: boolean };
}

export function SchemesClient(props: SchemesClientProps) {
    // No server-side filters — search is a live client-side filter over the
    // loaded list, so the filter context carries no defs / keys.
    const filterCtx = useFilterContext([], []);
    return (
        <FilterProvider value={filterCtx}>
            <SchemesPageInner {...props} />
        </FilterProvider>
    );
}

function SchemesPageInner({ initialSchemes, tenantSlug, permissions }: SchemesClientProps) {
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const router = useRouter();
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const { search, hasActive, clearAll } = useFilters();

    const schemesQuery = useTenantSWR<SchemeRow[]>(CACHE_KEYS.schemes.list(), {
        fallbackData: initialSchemes,
    });
    const allSchemes = schemesQuery.data ?? [];
    const loading = schemesQuery.isLoading && !schemesQuery.data;

    // Live, case-insensitive search over name + key.
    const schemes = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allSchemes;
        return allSchemes.filter(
            (s) => s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q),
        );
    }, [allSchemes, search]);

    const columns = useMemo(
        () =>
            createColumns<SchemeRow>([
                {
                    accessorKey: 'name',
                    header: 'Name',
                    cell: ({ row, getValue }) => (
                        <TableTitleCell id={`scheme-name-${row.original.id}`}>
                            {getValue() as string}
                        </TableTitleCell>
                    ),
                },
                {
                    accessorKey: 'key',
                    header: 'Key',
                    cell: ({ getValue }) => (
                        <span className="font-mono text-xs text-content-muted">
                            {getValue() as string}
                        </span>
                    ),
                },
                {
                    id: 'requirements',
                    header: 'Requirements',
                    accessorFn: (s) => s._count?.requirements ?? 0,
                    cell: ({ getValue }) => (
                        <span className="tabular-nums text-content-muted">
                            {getValue() as number}
                        </span>
                    ),
                    meta: { disableTruncate: true },
                },
            ]),
        [],
    );

    return (
        <EntityListPage<SchemeRow>
            className="animate-fadeIn gap-section"
            header={{
                breadcrumbs: [
                    { label: 'Dashboard', href: tenantHref('/dashboard') },
                    { label: 'Schemes' },
                ],
                title: 'Certification Schemes',
                description: 'Certification standards your practices and records are mapped to.',
                actions: permissions.canAdmin ? (
                    <Button
                        variant="primary"
                        icon={<Plus className="-ml-0.5 -mr-2.5" />}
                        onClick={() => setIsCreateOpen(true)}
                        id="new-scheme-btn"
                    >
                        Scheme
                    </Button>
                ) : null,
            }}
            filters={{
                defs: [],
                searchId: 'scheme-search',
                searchPlaceholder: 'Search schemes…',
            }}
            table={{
                data: schemes,
                columns,
                loading,
                getRowId: (s) => s.id,
                emptyState: hasActive ? (
                    <EmptyState
                        size="sm"
                        variant="no-results"
                        title="No schemes match your search"
                        description="Try a different term or clear the search."
                        secondaryAction={{ label: 'Clear search', onClick: () => clearAll() }}
                    />
                ) : (
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title="No certification schemes yet"
                        description="Create a scheme — its requirements become the checklist your practices are mapped against."
                        primaryAction={
                            permissions.canAdmin
                                ? { label: 'Add scheme', onClick: () => setIsCreateOpen(true) }
                                : undefined
                        }
                    />
                ),
                resourceName: (p) => (p ? 'schemes' : 'scheme'),
                'data-testid': 'schemes-table',
                className: 'hover:bg-bg-muted',
            }}
        >
            {permissions.canAdmin && (
                <NewSchemeModal
                    open={isCreateOpen}
                    setOpen={setIsCreateOpen}
                    tenantSlug={tenantSlug}
                    onSaved={() => {
                        void schemesQuery.mutate();
                    }}
                />
            )}
        </EntityListPage>
    );
}
