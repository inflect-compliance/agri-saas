'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { DataTable, createColumns, useColumnsDropdown } from '@/components/ui/table';
import {
    FilterProvider,
    useFilterContext,
    useFilters,
} from '@/components/ui/filter';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { toApiSearchParams } from '@/lib/filters/url-sync';
import { buildAssetFilters, ASSET_FILTER_KEYS } from './filter-defs';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { NumberStepper } from '@/components/ui/number-stepper';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';
import { KpiFilterCard } from '@/components/ui/kpi-filter-card';
import { useKpiFilter, type KpiFilterDef } from '@/components/ui/kpi-filter';

const ASSET_TYPES = ['INFORMATION', 'APPLICATION', 'SYSTEM', 'SERVICE', 'DATA_STORE', 'INFRASTRUCTURE', 'VENDOR', 'PROCESS', 'PEOPLE_PROCESS', 'OTHER'];
const ASSET_TYPE_OPTIONS: ComboboxOption[] = ASSET_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') }));

interface AssetsClientProps {
    initialAssets: any[];
    initialFilters: Record<string, string>;
    tenantSlug: string;
    permissions: { canWrite: boolean };
    translations: {
        title: string;
        listDescription: string;
        addAsset: string;
        createAsset: string;
        name: string;
        type: string;
        classification: string;
        classificationPlaceholder: string;
        owner: string;
        location: string;
        dataResidency: string;
        residencyPlaceholder: string;
        confidentiality: string;
        integrity: string;
        availability: string;
        cia: string;
        controlsCol: string;
        noAssets: string;
        cancel: string;
        assetsRegistered: string;
    };
}

/**
 * Client island for assets — handles create form, filter interactions, and table navigation.
 * Data is pre-fetched server-side and passed via props.
 */
export function AssetsClient(props: AssetsClientProps) {
    const filterCtx = useFilterContext([], ASSET_FILTER_KEYS, {
        serverFilters: props.initialFilters,
    });
    return (
        <FilterProvider value={filterCtx}>
            <AssetsPageInner {...props} />
        </FilterProvider>
    );
}

function AssetsPageInner({ initialAssets, initialFilters, tenantSlug, permissions, translations: t }: AssetsClientProps) {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ name: '', type: 'SYSTEM', classification: '', owner: '', location: '', confidentiality: 3, integrity: 3, availability: 3, dataResidency: '', retention: '' });

    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;
    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const router = useRouter();
    const queryClient = useQueryClient();

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

    const assetsQuery = useQuery({
        queryKey: queryKeys.assets.list(tenantSlug, queryKeyFilters),
        queryFn: async () => {
            const qs = fetchParams.toString();
            const res = await fetch(apiUrl(`/assets${qs ? `?${qs}` : ''}`));
            if (!res.ok) throw new Error('Failed to fetch assets');
            return res.json();
        },
        initialData: filtersMatchInitial ? initialAssets : undefined,
    });
    const assets = assetsQuery.data ?? [];
    const liveFilters = useMemo(() => buildAssetFilters(), []);

    // R23-PR-D — KPI definitions for the Assets page. Mirrors the
    // Risks-page reference shape: typed id union, predicate per KPI
    // derives `isActive` from current filter state (so a card lights
    // up whether the user clicked the KPI or set the filter via the
    // dropdown). Granular `clear` callbacks scope toggle-off to each
    // KPI's own key (status / criticality), so sibling filters
    // survive.
    type AssetKpiId = 'total' | 'active' | 'critical' | 'retired';
    // guardrail-ignore: KPI counts across the loaded page, not a refilter.
    const totalAssets = assets.length;
    // guardrail-ignore: KPI count, not a refilter.
    const activeAssets = assets.filter((a: any) => a.status === 'ACTIVE').length;
    // guardrail-ignore: KPI count, not a refilter.
    const criticalAssets = assets.filter((a: any) => a.criticality === 'HIGH').length;
    // guardrail-ignore: KPI count, not a refilter.
    const retiredAssets = assets.filter((a: any) => a.status === 'RETIRED').length;
    const assetKpiDefs: ReadonlyArray<KpiFilterDef<AssetKpiId>> = useMemo(
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
                apply: (ctx) => ctx.set('criticality', 'HIGH'),
                isActive: (s) => (s.criticality ?? []).includes('HIGH'),
                clear: (ctx) => ctx.removeAll('criticality'),
            },
            {
                id: 'retired',
                apply: (ctx) => ctx.set('status', 'RETIRED'),
                isActive: (s) => (s.status ?? []).includes('RETIRED'),
                clear: (ctx) => ctx.removeAll('status'),
            },
        ],
        [],
    );
    const { activeKpiId: activeAssetKpi, toggle: toggleAssetKpi } =
        useKpiFilter(assetKpiDefs);

    const createMutation = useMutation({
        mutationFn: async (newAsset: any) => {
            const res = await fetch(apiUrl('/assets'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAsset) });
            if (!res.ok) throw new Error('Failed to create asset');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.assets.all(tenantSlug) });
            setShowForm(false);
            setForm({ name: '', type: 'SYSTEM', classification: '', owner: '', location: '', confidentiality: 3, integrity: 3, availability: 3, dataResidency: '', retention: '' });
        }
    });

    const createAsset = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate(form);
    };

    // R10-PR7 — column-visibility gear.
    const assetColumnList = useMemo(
        () => [
            { id: 'name', label: 'Name' },
            { id: 'type', label: 'Type' },
            { id: 'classification', label: 'Classification' },
            { id: 'owner', label: 'Owner' },
            { id: 'cia', label: 'C/I/A' },
            { id: 'controls', label: 'Controls' },
        ],
        [],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:assets',
        columns: assetColumnList,
    });

    const assetColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'name',
            header: t.name,
            cell: ({ getValue }: any) => <TableTitleCell>{getValue()}</TableTitleCell>,
        },
        {
            accessorKey: 'type',
            header: t.type,
            cell: ({ getValue }: any) => <StatusBadge variant="info">{String(getValue()).replace(/_/g, ' ')}</StatusBadge>,
        },
        {
            id: 'classification',
            header: t.classification,
            accessorFn: (a: any) => a.classification || '—',
        },
        {
            id: 'owner',
            header: t.owner,
            accessorFn: (a: any) => a.owner || '—',
        },
        {
            id: 'cia',
            header: t.cia,
            accessorFn: (a: any) => `${a.confidentiality}/${a.integrity}/${a.availability}`,
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            id: 'controls',
            header: t.controlsCol,
            accessorFn: (a: any) => a._count?.controls || 0,
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
    ]), [t]);

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <div className="flex items-center justify-between">
                    <div>
                        <PageBreadcrumbs
                            items={[
                                { label: 'Dashboard', href: tenantHref('/dashboard') },
                                { label: t.title },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1}>{t.title}</Heading>
                        {t.listDescription && (
                            <p className="text-sm text-content-muted mt-1">{t.listDescription}</p>
                        )}
                    </div>
                    <div className="flex gap-tight">
                        <Link href={tenantHref('/coverage')} className={buttonVariants({ variant: 'secondary' })}>Coverage</Link>
                        <Button variant="primary" onClick={() => setShowForm(!showForm)}>{t.addAsset}</Button>
                    </div>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-section">
                {/* R23-PR-D — KPI strip above the filter toolbar.
                    Mirrors the Risks-page reference layout exactly:
                    same grid, same gap, same KpiFilterCard primitive,
                    KPIs derived from filter state via useKpiFilter. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <KpiFilterCard
                        label="Total assets"
                        value={totalAssets}
                        onClick={() => toggleAssetKpi('total')}
                        selected={activeAssetKpi === 'total'}
                    />
                    <KpiFilterCard
                        label="Active"
                        value={activeAssets}
                        tone="success"
                        onClick={() => toggleAssetKpi('active')}
                        selected={activeAssetKpi === 'active'}
                    />
                    <KpiFilterCard
                        label="High criticality"
                        value={criticalAssets}
                        tone={criticalAssets > 0 ? 'critical' : 'default'}
                        onClick={() => toggleAssetKpi('critical')}
                        selected={activeAssetKpi === 'critical'}
                    />
                    <KpiFilterCard
                        label="Retired"
                        value={retiredAssets}
                        tone="attention"
                        onClick={() => toggleAssetKpi('retired')}
                        selected={activeAssetKpi === 'retired'}
                    />
                </div>
                <FilterToolbar
                    filters={liveFilters}
                    actions={columnsDropdown}
                />
            </ListPageShell.Filters>

            {showForm && (
                <form onSubmit={createAsset} className={cn(cardVariants(), 'space-y-default animate-fadeIn')}>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-default">
                        <div><label className="input-label">{t.name} *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                        <div><label className="input-label">{t.type}</label><Combobox hideSearch selected={ASSET_TYPE_OPTIONS.find(o => o.value === form.type) ?? null} setSelected={(opt) => setForm(f => ({ ...f, type: opt?.value ?? 'SYSTEM' }))} options={ASSET_TYPE_OPTIONS} matchTriggerWidth /></div>
                        <div><label className="input-label">{t.classification}</label><input className="input" value={form.classification} onChange={e => setForm(f => ({ ...f, classification: e.target.value }))} placeholder={t.classificationPlaceholder} /></div>
                        <div><label className="input-label">{t.owner}</label><input className="input" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} /></div>
                        <div><label className="input-label">{t.location}</label><input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
                        <div><label className="input-label">{t.dataResidency}</label><input className="input" value={form.dataResidency} onChange={e => setForm(f => ({ ...f, dataResidency: e.target.value }))} placeholder={t.residencyPlaceholder} /></div>
                        {/* Epic 60 — NumberStepper size="sm" on the CIA triple.
                            Replaces bare <input type=number> which had no
                            accessible label, no keyboard +/- affordance, and
                            variable rendering across browsers. min/max=1..5
                            matches the ISO 27005 impact scale. */}
                        <div>
                            <label className="input-label" htmlFor="asset-confidentiality">{t.confidentiality}</label>
                            <NumberStepper
                                id="asset-confidentiality"
                                size="sm"
                                ariaLabel={t.confidentiality}
                                min={1}
                                max={5}
                                value={form.confidentiality}
                                onChange={(v) => setForm(f => ({ ...f, confidentiality: v }))}
                            />
                        </div>
                        <div>
                            <label className="input-label" htmlFor="asset-integrity">{t.integrity}</label>
                            <NumberStepper
                                id="asset-integrity"
                                size="sm"
                                ariaLabel={t.integrity}
                                min={1}
                                max={5}
                                value={form.integrity}
                                onChange={(v) => setForm(f => ({ ...f, integrity: v }))}
                            />
                        </div>
                        <div>
                            <label className="input-label" htmlFor="asset-availability">{t.availability}</label>
                            <NumberStepper
                                id="asset-availability"
                                size="sm"
                                ariaLabel={t.availability}
                                min={1}
                                max={5}
                                value={form.availability}
                                onChange={(v) => setForm(f => ({ ...f, availability: v }))}
                            />
                        </div>
                    </div>
                    <div className="flex gap-tight"><Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t.cancel}</Button><Button type="submit" variant="primary">{t.createAsset}</Button></div>
                </form>
            )}

            <ListPageShell.Body>
                <DataTable
                    fillBody
                    data={assets}
                    columns={assetColumns}
                    getRowId={(a: any) => a.id}
                    columnVisibility={columnVisibility}
                    onColumnVisibilityChange={setColumnVisibility}
                    onRowClick={(row) => router.push(tenantHref(`/assets/${row.original.id}`))}
                    emptyState={
                        hasActive ? (
                            <EmptyState
                                size="sm"
                                variant="no-results"
                                title="No assets match your filters"
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
                                title={t.noAssets}
                                description="Register the systems, applications, and data stores in scope before mapping risks and controls."
                                primaryAction={
                                    permissions.canWrite
                                        ? {
                                              label: 'Add asset',
                                              onClick: () => setShowForm(true),
                                          }
                                        : undefined
                                }
                            />
                        )
                    }
                    resourceName={(p) => p ? 'assets' : 'asset'}
                    data-testid="assets-table"
                    className="hover:bg-bg-muted"
                />
            </ListPageShell.Body>
        </ListPageShell>
    );
}
