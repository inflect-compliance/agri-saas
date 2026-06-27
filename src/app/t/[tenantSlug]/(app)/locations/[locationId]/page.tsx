'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { Geometry, LineString, Polygon } from 'geojson';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { DataTable, createColumns } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CoachMark } from '@/components/ui/coach-mark';
import { Heading } from '@/components/ui/typography';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPost, apiPatch, ApiClientError } from '@/lib/api-client';
import { SpatialImportModal } from '@/components/ui/map/SpatialImportModal';
import { PrescriptionPanel } from '@/components/ui/map/PrescriptionPanel';
import { FieldOperationPanel } from '@/components/ui/map/FieldOperationPanel';
import { ParcelDetailSheet, type ParcelSheetData } from '@/components/ui/map/ParcelDetailSheet';
import { SprayJobWizard } from './SprayJobWizard';
import { SmartDefaultsBanner } from './SmartDefaultsBanner';
import { FieldReportCard } from './FieldReportCard';
import type { LocationSmartDefaults } from '@/app-layer/usecases/smart-defaults';
import { Plus } from '@/components/ui/icons/nucleo';
import { useMediaQuery, useToast } from '@/components/ui/hooks';
import { nearestParcel } from '@/lib/spatial/nearest';
import { cn } from '@/lib/cn';
import type { MapParcel, MapMode } from '@/components/ui/map/MapCanvas';

const MapCanvas = dynamic(() => import('@/components/ui/map/MapCanvas').then((m) => m.MapCanvas), { ssr: false });

type Tab = 'overview' | 'map' | 'parcels' | 'operations';

interface LocationDetail {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    spatialFormat?: string | null;
    _count?: { parcels?: number };
}
interface ParcelsResp {
    locationId: string;
    bounds: [number, number, number, number] | null;
    parcels: Array<{ id: string; name: string; areaHa?: number | null; cropType?: string | null; geometry: unknown }>;
}
interface OperationItem {
    id: string;
    key?: string | null;
    title: string;
    status: string;
    assignee?: { id: string; name?: string | null } | null;
    _count?: { operationParcels?: number };
}

export default function LocationDetailPage() {
    const { tenantSlug, locationId } = useParams<{ tenantSlug: string; locationId: string }>();
    const buildUrl = useTenantApiUrl();
    const { isMobile } = useMediaQuery();
    const toast = useToast();
    const [tab, setTab] = useState<Tab>('overview');
    const [selected, setSelected] = useState<string[]>([]);
    // Mobile: the tapped parcel surfaced in the bottom-sheet (vaul). The
    // sheet replaces the inline side panel below the map on phones; desktop
    // keeps the side panel.
    const [sheetParcelId, setSheetParcelId] = useState<string | null>(null);
    // Deep-link entry (QR codes on parcels): `?parcelId` opens that parcel's
    // detail sheet on the map tab; `?tab` selects a tab. Read once on mount.
    const searchParams = useSearchParams();
    useEffect(() => {
        const t = searchParams.get('tab');
        if (t === 'overview' || t === 'map' || t === 'parcels' || t === 'operations') setTab(t);
        const pid = searchParams.get('parcelId');
        if (pid) {
            setSheetParcelId(pid);
            if (!t) setTab('map');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deep-link read on mount only
    }, []);
    const [wizardParcelIds, setWizardParcelIds] = useState<string[]>([]);
    const [showImport, setShowImport] = useState(false);
    const [showSprayWizard, setShowSprayWizard] = useState(false);
    const [activeJob, setActiveJob] = useState<string | null>(null);
    const [mapMode, setMapMode] = useState<MapMode>('select');
    const [pendingGeometry, setPendingGeometry] = useState<Polygon | null>(null);
    const [newParcelName, setNewParcelName] = useState('');
    const [saving, setSaving] = useState(false);
    const [showNdvi, setShowNdvi] = useState(false);
    // Merge: name-the-union modal (mirrors the draw → name-parcel flow).
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergeName, setMergeName] = useState('');
    const [merging, setMerging] = useState(false);
    const [mergeError, setMergeError] = useState<string | null>(null);
    // Split: surfaces the "must fully cross" 400 inline; stays in split mode.
    const [splitting, setSplitting] = useState(false);
    const [splitError, setSplitError] = useState<string | null>(null);

    const locQ = useTenantSWR<LocationDetail>(`/locations/${locationId}`);
    const parcelsQ = useTenantSWR<ParcelsResp>(`/locations/${locationId}/parcels`);
    const opsQ = useTenantSWR<OperationItem[]>(tab === 'operations' ? `/locations/${locationId}/operations` : null);
    // Recall + weather + crop-plan suggestions for this field (editable;
    // powers the spray-window/next-task banner + the wizard prefills).
    const smartQ = useTenantSWR<LocationSmartDefaults>(`/locations/${locationId}/smart-defaults`);
    // NDVI tile source (Agro-intel) — fetched only when the Map tab is open.
    const ndviQ = useTenantSWR<{ configured: boolean; tileUrl: string }>(
        tab === 'map' ? '/agro/ndvi-config' : null,
    );
    const ndviConfigured = ndviQ.data?.configured ?? false;
    const ndviTileUrl = ndviQ.data?.tileUrl ?? '';

    const loc = locQ.data;
    const parcels = useMemo(() => parcelsQ.data?.parcels ?? [], [parcelsQ.data]);
    const bounds = parcelsQ.data?.bounds ?? null;
    const mapParcels = useMemo<MapParcel[]>(
        () => parcels.map((p) => ({ id: p.id, name: p.name, areaHa: p.areaHa ?? null, geometry: (p.geometry ?? null) as Geometry | null })),
        [parcels],
    );

    const sheetParcel = useMemo<ParcelSheetData | null>(() => {
        const p = parcels.find((x) => x.id === sheetParcelId);
        return p ? { id: p.id, name: p.name, areaHa: p.areaHa ?? null, cropType: p.cropType ?? null } : null;
    }, [parcels, sheetParcelId]);

    // On phones, tapping a parcel both selects it and opens the bottom-sheet
    // for the freshly-tapped parcel; on desktop selection just feeds the
    // inline side panel (no sheet).
    const handleMapSelection = (ids: string[]) => {
        if (isMobile) {
            const added = ids.find((id) => !selected.includes(id));
            if (added) setSheetParcelId(added);
        }
        setSelected(ids);
    };

    // "Start operation here" — seed a single-parcel spray job and open the
    // wizard at the product step.
    const startOperationHere = (parcelId: string) => {
        setSheetParcelId(null);
        setSelected([parcelId]);
        setWizardParcelIds([parcelId]);
        setShowSprayWizard(true);
    };

    type ParcelRow = ParcelsResp['parcels'][number];
    const parcelColumns = useMemo(
        () =>
            createColumns<ParcelRow>([
                {
                    accessorKey: 'name',
                    header: 'Name',
                    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
                    // Mobile (<sm) card heading.
                    meta: { mobileCard: { slot: 'title' } },
                },
                {
                    id: 'crop',
                    header: 'Crop',
                    cell: ({ row }) => row.original.cropType ?? '—',
                    // Mobile card key/value row — the parcel's crop.
                    meta: { mobileCard: { slot: 'meta', label: 'Crop' } },
                },
                {
                    id: 'areaHa',
                    header: 'Area (ha)',
                    cell: ({ row }) => row.original.areaHa ?? '—',
                    // Mobile card key/value row — parcel area.
                    meta: { mobileCard: { slot: 'meta', label: 'Area (ha)' } },
                },
            ]),
        [],
    );

    const saveDrawnParcel = async () => {
        if (!pendingGeometry || !newParcelName.trim()) return;
        setSaving(true);
        try {
            await apiPost(buildUrl(`/locations/${locationId}/parcels`), {
                name: newParcelName.trim(),
                geometry: pendingGeometry,
            });
            setPendingGeometry(null);
            setNewParcelName('');
            await parcelsQ.mutate();
            await locQ.mutate();
        } finally {
            setSaving(false);
        }
    };

    const reshapeParcel = async (parcelId: string, geometry: Polygon) => {
        await apiPatch(buildUrl(`/locations/${locationId}/parcels/${parcelId}`), { geometry });
        await parcelsQ.mutate();
    };

    const mergeParcels = async () => {
        if (selected.length < 2 || !mergeName.trim()) return;
        setMerging(true);
        setMergeError(null);
        try {
            await apiPost(buildUrl(`/locations/${locationId}/parcels/merge`), {
                parcelIds: selected,
                name: mergeName.trim(),
            });
            setMergeOpen(false);
            setMergeName('');
            setSelected([]);
            await parcelsQ.mutate();
            await locQ.mutate();
        } catch (err) {
            setMergeError(err instanceof ApiClientError ? err.message : 'Failed to merge parcels.');
        } finally {
            setMerging(false);
        }
    };

    const splitParcel = async (line: LineString) => {
        // Exactly one selected parcel is the target (the toolbar gates this).
        const targetId = selected[0];
        if (!targetId || splitting) return;
        setSplitting(true);
        setSplitError(null);
        try {
            await apiPost(buildUrl(`/locations/${locationId}/parcels/${targetId}/split`), { line });
            setSelected([]);
            await parcelsQ.mutate();
            await locQ.mutate();
            setMapMode('select');
        } catch (err) {
            // A blade that doesn't fully cross returns 400 "must fully cross".
            // Surface it inline and stay in split mode so the user retries.
            setSplitError(err instanceof ApiClientError ? err.message : 'Failed to split parcel.');
        } finally {
            setSplitting(false);
        }
    };

    const tabs = [
        { key: 'overview' as const, label: 'Overview' },
        { key: 'map' as const, label: 'Map' },
        { key: 'parcels' as const, label: 'Parcels', count: loc?._count?.parcels ?? parcels.length },
        { key: 'operations' as const, label: 'Operations' },
    ];

    const breadcrumbs: { label: string; href?: string }[] = [
        { label: 'Locations', href: `/t/${tenantSlug}/locations` },
        { label: loc?.name ?? 'Location' },
    ];

    return (
        <EntityDetailLayout<Tab>
            breadcrumbs={breadcrumbs}
            back={{ href: `/t/${tenantSlug}/locations`, label: 'Locations' }}
            title={loc?.name ?? 'Location'}
            loading={locQ.isLoading && !loc}
            error={locQ.error ? 'Failed to load location.' : null}
            actions={
                <div className="flex items-center gap-compact">
                    <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>Import parcels</Button>
                    <CoachMark
                        id="field-op-wizard"
                        title="Plan a field job"
                        body="Start here to record a spray or other operation — pick the parcels, the product, and the rate, and it becomes a tracked job."
                        placement="bottom"
                    >
                        <Button
                            variant="primary"
                            size="sm"
                            icon={<Plus className="size-4" />}
                            onClick={() => { setWizardParcelIds([]); setShowSprayWizard(true); }}
                            disabled={parcels.length === 0}
                            data-testid="new-spray-job"
                        >
                            Spray job
                        </Button>
                    </CoachMark>
                </div>
            }
            tabs={tabs}
            activeTab={tab}
            onTabChange={setTab}
        >
            {tab === 'overview' && (
                <div className="space-y-default">
                    <SmartDefaultsBanner data={smartQ.data} />
                    <dl className="grid grid-cols-2 gap-default text-sm sm:grid-cols-3">
                        <div><dt className="text-content-secondary">Status</dt><dd className="font-medium">{loc?.status ?? '—'}</dd></div>
                        <div><dt className="text-content-secondary">Parcels</dt><dd className="font-medium">{loc?._count?.parcels ?? parcels.length}</dd></div>
                        <div><dt className="text-content-secondary">Spatial format</dt><dd className="font-medium">{loc?.spatialFormat ?? '—'}</dd></div>
                    </dl>
                    {loc?.description && <p className="text-sm">{loc.description}</p>}
                    {parcels.length === 0 && (
                        <div className="rounded-lg border border-border-subtle p-6 text-sm text-content-secondary">
                            No parcels yet — use “Import parcels” to upload a shapefile, KML, or GeoJSON.
                        </div>
                    )}
                    {loc && parcels.length > 0 && (
                        <FieldReportCard locationName={loc.name} parcels={parcels} />
                    )}
                </div>
            )}

            {tab === 'map' && (
                <div className="space-y-default">
                    <SmartDefaultsBanner data={smartQ.data} />
                    <div className="flex flex-wrap items-center gap-compact">
                        <ToggleGroup
                            ariaLabel="Map mode"
                            // Field operators tap these on a phone — bump each
                            // segment to a ≥44px (WCAG 2.5.5) touch target.
                            optionClassName="min-h-[44px] min-w-[44px] justify-center"
                            options={[
                                { value: 'select', label: 'Select' },
                                { value: 'draw', label: 'Draw' },
                                { value: 'edit', label: 'Edit' },
                                { value: 'split', label: 'Split' },
                            ]}
                            selected={mapMode}
                            selectAction={(v) => {
                                const next = v as MapMode;
                                setSplitError(null);
                                // Selection is disabled inside split mode (terra-draw owns
                                // the pointer there), so carry a single selected parcel over
                                // as the split target. Every other mode clears selection.
                                setSelected((prev) => (next === 'split' && prev.length === 1 ? prev : []));
                                setMapMode(next);
                            }}
                        />
                        <span className="text-xs text-content-subtle">
                            {mapMode === 'draw'
                                ? 'Click to add vertices; double-click to finish the parcel.'
                                : mapMode === 'edit'
                                  ? 'Drag a vertex to reshape; changes save automatically.'
                                  : mapMode === 'split'
                                    ? 'Draw a line across the target parcel to split it in two.'
                                    : 'Click parcels to select them for a spray job.'}
                        </span>
                        {mapMode === 'select' && selected.length >= 2 && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => { setMergeError(null); setMergeName(''); setMergeOpen(true); }}
                            >
                                Merge
                            </Button>
                        )}
                        <div className="ml-auto flex items-center gap-compact">
                            <Button
                                variant={showNdvi && ndviConfigured ? 'primary' : 'secondary'}
                                size="sm"
                                // Layer toggle is a field thumb target → ≥44px.
                                className="min-h-[44px] min-w-[44px]"
                                onClick={() => setShowNdvi((v) => !v)}
                                disabled={!ndviConfigured}
                                aria-pressed={showNdvi && ndviConfigured}
                            >
                                NDVI
                            </Button>
                            {!ndviConfigured && (
                                <span className="text-xs text-content-subtle">
                                    Configure an NDVI tile source to enable the overlay.
                                </span>
                            )}
                        </div>
                    </div>
                    <div className={cn('gap-section', !isMobile && 'grid grid-cols-1 md:grid-cols-[1fr_320px]')}>
                        <MapCanvas
                            parcels={mapParcels}
                            bounds={bounds}
                            selectedIds={selected}
                            onSelectionChange={handleMapSelection}
                            // GPS-aware: a Locate-me tap auto-selects the
                            // nearest field (a suggestion — tap another to
                            // override). Reuses the same locate-me fix.
                            onLocationChange={(loc) => {
                                const hit = nearestParcel(mapParcels, loc);
                                if (!hit) return;
                                setSelected([hit.parcel.id]);
                                toast.success(`Nearest field: ${hit.parcel.name}`, {
                                    description: 'Auto-selected from your location — tap another to change.',
                                });
                            }}
                            mode={mapMode}
                            // Phone-native: thumb-reachable zoom + locate-me
                            // (with live-tracking), lifted clear of the fixed
                            // bottom-tab bar.
                            showControls
                            controlsBottomInset={isMobile ? 76 : 12}
                            liveTracking
                            // Full-bleed on phones — edge-to-edge (cancel the
                            // page's px-4) and near-viewport-tall so the map is
                            // the operator's primary screen.
                            className={isMobile
                                ? '-mx-4 h-[calc(100dvh-15rem)] min-h-[22rem] overflow-hidden border-y border-border-subtle'
                                : undefined}
                            onCreateGeometry={(g) => setPendingGeometry(g)}
                            onUpdateGeometry={reshapeParcel}
                            onCreateSplitLine={(line) => { void splitParcel(line); }}
                            showNdvi={showNdvi && ndviConfigured}
                            ndviTileUrl={ndviTileUrl}
                            // Read-only vector-tile source (perf at scale). The
                            // {z}/{x}/{y} placeholders are kept literal for
                            // MapLibre to substitute (buildUrl doesn't encode
                            // the path). This Map tab is interactive (select +
                            // draw/edit/split), so MapCanvas no-ops the vector
                            // source here — it only engages on pure read-only
                            // mounts. Passed so the prop is exercised + ready
                            // for a future read-only farm view.
                            vectorTileUrl={buildUrl(`/locations/${locationId}/tiles/{z}/{x}/{y}.pbf`)}
                        />
                        {/* Only the SELECT-mode spray panel is desktop-only —
                            on phones the parcel bottom-sheet replaces it. The
                            draw/edit/split contextual panels (instructions +
                            errors) still render on mobile so authoring has
                            feedback there too. */}
                        {mapMode === 'select' ? (
                            !isMobile && (
                            <div className="rounded-lg border border-border-subtle p-4">
                                <Heading level={3} className="mb-3">New spray job</Heading>
                                <PrescriptionPanel
                                    locationId={locationId}
                                    tenantSlug={tenantSlug}
                                    selectedParcelIds={selected}
                                    onCreated={() => { setSelected([]); setTab('operations'); }}
                                />
                                {selected.length >= 2 && (
                                    <p className="mt-3 text-xs text-content-subtle">
                                        {selected.length} parcels selected — use “Merge” above to combine them into one.
                                    </p>
                                )}
                            </div>
                            )
                        ) : mapMode === 'split' ? (
                            <div className="space-y-default rounded-lg border border-border-subtle p-4">
                                <Heading level={3}>Split parcel</Heading>
                                <p className="text-sm text-content-secondary">
                                    {selected.length === 1
                                        ? 'Draw a line that fully crosses the selected parcel to cut it in two.'
                                        : 'No target parcel. Switch to Select, click one parcel, then return to Split.'}
                                </p>
                                {splitting && (
                                    <p className="text-sm text-content-secondary">Splitting parcel…</p>
                                )}
                                {splitError && (
                                    <div role="alert" className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                                        {splitError}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-border-subtle p-4 text-sm text-content-secondary">
                                {mapMode === 'draw'
                                    ? 'Draw a polygon on the map. You’ll name it before it’s saved.'
                                    : 'Reshape parcels by dragging their vertices. Switch to Select to plan a spray job.'}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === 'parcels' && (
                <DataTable<ParcelRow>
                    data={parcels}
                    columns={parcelColumns}
                    getRowId={(p) => p.id}
                    // <sm: render each parcel as a card. Tapping a card opens
                    // the parcel bottom-sheet (area / crop / apply-rate calc /
                    // "Start operation here") — the same sheet a map tap opens.
                    mobileFallback="card"
                    onRowClick={(row) => setSheetParcelId(row.original.id)}
                    loading={parcelsQ.isLoading && parcels.length === 0}
                    emptyState={(
                        <div className="p-6 text-sm text-content-secondary">
                            No parcels yet — use “Import parcels” to upload a shapefile, KML, or GeoJSON.
                        </div>
                    )}
                />
            )}

            {tab === 'operations' && (
                <div className="space-y-section">
                    {(opsQ.data ?? []).length === 0 ? (
                        <div className="rounded-lg border border-border-subtle p-6 text-sm text-content-secondary">
                            No spray jobs yet. Select parcels on the Map tab to create one.
                        </div>
                    ) : (
                        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                            {(opsQ.data ?? []).map((op) => (
                                <li key={op.id}>
                                    <button
                                        type="button"
                                        onClick={() => setActiveJob(activeJob === op.id ? null : op.id)}
                                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-bg-muted/50"
                                    >
                                        <span className="text-sm font-medium">{op.key ? `${op.key} · ` : ''}{op.title}</span>
                                        <span className="text-xs text-content-secondary">{op.status} · {op._count?.operationParcels ?? 0} parcels</span>
                                    </button>
                                    {activeJob === op.id && (
                                        <div className="border-t border-border-subtle p-4">
                                            <FieldOperationPanel taskId={op.id} />
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <SpatialImportModal
                locationId={locationId}
                open={showImport}
                setOpen={setShowImport}
                onImported={({ parcelCount, skipped }) => {
                    toast.success(
                        `Imported ${parcelCount} parcel${parcelCount === 1 ? '' : 's'}` +
                            (skipped > 0
                                ? ` — ${skipped} non-polygon feature${skipped === 1 ? '' : 's'} skipped`
                                : '') +
                            '.',
                    );
                    locQ.mutate();
                    parcelsQ.mutate();
                }}
            />

            <SprayJobWizard
                open={showSprayWizard}
                onOpenChange={setShowSprayWizard}
                locationId={locationId}
                parcels={parcels.map((p) => ({ id: p.id, name: p.name, areaHa: p.areaHa ?? null }))}
                initialParcelIds={wizardParcelIds}
                smartDefaults={smartQ.data}
                onCreated={() => { setTab('operations'); void opsQ.mutate(); }}
            />

            {/* Phone parcel bottom-sheet — opened by a map tap or a parcel
                card tap. Desktop uses the inline side panel instead. */}
            <ParcelDetailSheet
                open={sheetParcelId !== null}
                onOpenChange={(o) => { if (!o) setSheetParcelId(null); }}
                parcel={sheetParcel}
                onStartOperation={startOperationHere}
                deepLinkUrl={
                    sheetParcelId && typeof window !== 'undefined'
                        ? `${window.location.origin}/t/${tenantSlug}/locations/${locationId}?parcelId=${sheetParcelId}&tab=map`
                        : undefined
                }
            />

            <Modal
                showModal={!!pendingGeometry}
                setShowModal={(v) => { if (!v) { setPendingGeometry(null); setNewParcelName(''); } }}
                size="sm"
                title="Name parcel"
                description="Name the parcel you just drew."
            >
                <Modal.Header title="Name parcel" description="Give the drawn parcel a name to save it." />
                <Modal.Form id="name-parcel-form" onSubmit={(e) => { e.preventDefault(); void saveDrawnParcel(); }}>
                    <Modal.Body>
                        <FormField label="Name" required>
                            <Input value={newParcelName} onChange={(e) => setNewParcelName(e.target.value)} placeholder="e.g. North 40" />
                        </FormField>
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => { setPendingGeometry(null); setNewParcelName(''); }}>Cancel</Button>
                        <Button variant="primary" size="sm" type="submit" loading={saving} disabled={!newParcelName.trim() || saving}>Create parcel</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>

            <Modal
                showModal={mergeOpen}
                setShowModal={(v) => { if (!v) { setMergeOpen(false); setMergeName(''); setMergeError(null); } }}
                size="sm"
                title="Merge parcels"
                description="Name the parcel formed by merging the selected parcels."
            >
                <Modal.Header title="Merge parcels" description={`Combine ${selected.length} selected parcels into one. The originals are replaced.`} />
                <Modal.Form id="merge-parcels-form" onSubmit={(e) => { e.preventDefault(); void mergeParcels(); }}>
                    <Modal.Body>
                        <FormField label="Name" required>
                            <Input value={mergeName} onChange={(e) => setMergeName(e.target.value)} placeholder="e.g. North block" />
                        </FormField>
                        {mergeError && (
                            <div role="alert" className="mt-3 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                                {mergeError}
                            </div>
                        )}
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => { setMergeOpen(false); setMergeName(''); setMergeError(null); }}>Cancel</Button>
                        <Button variant="primary" size="sm" type="submit" loading={merging} disabled={selected.length < 2 || !mergeName.trim() || merging}>Merge parcels</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>
        </EntityDetailLayout>
    );
}
