'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { DataTable, createColumns } from '@/components/ui/table';
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
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

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

    const assetColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'name',
            header: t.name,
            cell: ({ getValue }: any) => <span className="font-medium text-content-emphasis">{getValue()}</span>,
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
                        <Breadcrumbs
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

            <ListPageShell.Filters>
                <FilterToolbar
                    filters={liveFilters}
                    searchId="asset-search"
                    searchPlaceholder="Search assets…"
                />
            </ListPageShell.Filters>

            {showForm && (
                <form onSubmit={createAsset} className="glass-card p-6 space-y-default animate-fadeIn">
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
                    <div className="flex gap-tight"><Button type="submit" variant="primary">{t.createAsset}</Button><Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t.cancel}</Button></div>
                </form>
            )}

            <ListPageShell.Body>
                <DataTable
                    fillBody
                    data={assets}
                    columns={assetColumns}
                    getRowId={(a: any) => a.id}
                    onRowClick={(row) => router.push(tenantHref(`/assets/${row.original.id}`))}
                    emptyState={hasActive ? 'No assets match your filters' : t.noAssets}
                    resourceName={(p) => p ? 'assets' : 'asset'}
                    data-testid="assets-table"
                    className="hover:bg-bg-muted"
                />
            </ListPageShell.Body>
        </ListPageShell>
    );
}
