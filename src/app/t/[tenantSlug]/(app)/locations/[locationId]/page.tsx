'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useSearchParams } from 'next/navigation';
import type { Geometry } from 'geojson';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { DataTable, createColumns } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { CoachMark } from '@/components/ui/coach-mark';
import { Heading } from '@/components/ui/typography';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { CROP_OPTIONS } from '@/lib/agriculture/crop-options';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { DatePicker, type DateValue } from '@/components/ui/date-picker';
import { toYMD } from '@/components/ui/date-picker/date-utils';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { StatusBadge } from '@/components/ui/status-badge';
import { InlineNotice } from '@/components/ui/inline-notice';
import { formatDateTime } from '@/lib/format-date';
import { apiPost, apiPatch, ApiClientError } from '@/lib/api-client';
import { SpatialImportModal } from '@/components/ui/map/SpatialImportModal';
import { PrescriptionPanel } from '@/components/ui/map/PrescriptionPanel';
import { FieldOperationPanel } from '@/components/ui/map/FieldOperationPanel';
import { ParcelDetailSheet, type ParcelSheetData } from '@/components/ui/map/ParcelDetailSheet';
import { SoilLegend } from '@/components/soil/SoilLegend';
import { CropLegend } from '@/components/agriculture/CropLegend';
import { soilColorForTexture, type SoilProfile } from '@/lib/soil/types';
import type { UsdaTextureClass } from '@/lib/soil/texture';
import { SprayJobWizard } from './SprayJobWizard';
import { SmartDefaultsBanner } from './SmartDefaultsBanner';
import type { LocationSmartDefaults } from '@/app-layer/usecases/smart-defaults';
import { Plus, CalendarIcon } from '@/components/ui/icons/nucleo';
import { useMediaQuery, useToast } from '@/components/ui/hooks';
import { cn } from '@/lib/cn';
import type { MapParcel } from '@/components/ui/map/MapCanvas';
import {
    VEGETATION_INDICES,
    vegetationIndexById,
    type VegetationIndex,
} from '@/lib/agro/vegetation-indices';

const MapCanvas = dynamic(() => import('@/components/ui/map/MapCanvas').then((m) => m.MapCanvas), { ssr: false });

type Tab = 'overview' | 'map' | 'operations' | 'records';

interface FarmRecordRow {
    fileRecordId: string;
    fileName: string;
    from: string;
    to: string;
    generatedAt: string;
    auto: boolean;
    generatedByName: string | null;
    sizeBytes: number;
}
interface FarmRecordsResp {
    records: FarmRecordRow[];
    completeness: { missingLabels: string[] };
}

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
    parcels: Array<{
        id: string;
        name: string;
        areaHa?: number | null;
        cropType?: string | null;
        geometry: unknown;
        soilType?: string | null;
        soilJson?: SoilProfile | null;
    }>;
}
interface OperationItem {
    id: string;
    key?: string | null;
    title: string;
    status: string;
    assignee?: { id: string; name?: string | null } | null;
    _count?: { operationParcels?: number };
}

// Crop options for the parcel Crop dropdown live in the shared catalogue
// (src/lib/agriculture/crop-options.ts) so the import crop-step (#7), map
// crop icons (#1), and crop planning (#9) all pick from the same list.

/**
 * Inline crop picker for a parcel row in the Parcels dropdown. Choosing a
 * crop PATCHes `cropType` and refreshes the list. An existing crop that
 * isn't one of the six options is still shown (as its own synthetic value)
 * so an imported cropType is never hidden.
 */
function ParcelCropSelect({
    value,
    onChange,
}: {
    value: string | null;
    onChange: (cropType: string) => Promise<void> | void;
}) {
    const t = useTranslations('locations.detail');
    const [saving, setSaving] = useState(false);
    const selected =
        CROP_OPTIONS.find((o) => o.value === value) ??
        (value ? { value, label: value, meta: { season: '' } } : null);
    return (
        // Stop the row-click (which opens the parcel sheet) from firing when
        // the operator interacts with the crop dropdown.
        <div onClick={(e) => e.stopPropagation()}>
            <Combobox
                options={CROP_OPTIONS}
                selected={selected}
                setSelected={(o) => {
                    setSaving(true);
                    Promise.resolve(onChange(o?.value ?? '')).finally(() => setSaving(false));
                }}
                optionRight={(o) =>
                    o.meta?.season ? (
                        <span className="text-xs text-content-subtle">{o.meta.season}</span>
                    ) : null
                }
                placeholder={t('setCropPlaceholder')}
                hideSearch
                matchTriggerWidth
                caret
                buttonProps={{ className: 'w-full', disabled: saving }}
            />
        </div>
    );
}

export default function LocationDetailPage() {
    const t = useTranslations('locations.detail');
    const tl = useTranslations('locations');
    const tCommon = useTranslations('common');
    const tSoil = useTranslations('ag.soil');
    const { tenantSlug, locationId } = useParams<{ tenantSlug: string; locationId: string }>();
    const buildUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
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
        if (t === 'overview' || t === 'map' || t === 'operations' || t === 'records') setTab(t);
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
    // БАБХ ДНЕВНИК (PDF) — minimal trigger: a date range (defaults to the
    // current season, Jan 1 → today) → POST → stream the filled PDF download.
    const [showDnevnik, setShowDnevnik] = useState(false);
    const [dnevnikBusy, setDnevnikBusy] = useState(false);
    const [dnevnikFrom, setDnevnikFrom] = useState<DateValue>(() => {
        const n = new Date();
        return new Date(Date.UTC(n.getFullYear(), 0, 1));
    });
    const [dnevnikTo, setDnevnikTo] = useState<DateValue>(() => {
        const n = new Date();
        return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
    });
    const generateDnevnik = useCallback(async () => {
        setDnevnikBusy(true);
        try {
            const res = await fetch(buildUrl(`/locations/${locationId}/farm-record`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: toYMD(dnevnikFrom), to: toYMD(dnevnikTo) }),
            });
            if (!res.ok) throw new Error((await res.text()) || 'PDF generation failed');
            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition');
            const m = disposition?.match(/filename="?([^"]+)"?/);
            const fileName = m?.[1] || `dnevnik-${toYMD(dnevnikFrom)}_${toYMD(dnevnikTo)}.pdf`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setShowDnevnik(false);
        } catch {
            toast.error(t('dnevnikGenerateFail'));
        } finally {
            setDnevnikBusy(false);
        }
    }, [buildUrl, locationId, dnevnikFrom, dnevnikTo, toast, t]);
    // Satellite vegetation-index overlay (Google Earth Engine). At most one
    // index (NDVI / NDMI / NDRE / GNDVI / EVI) is active at a time — they are
    // mutually exclusive. `null` = off (the default). The single inspection
    // date below drives whichever is active; it sets the 30-day composite
    // window (UTC-midnight DateValue per the picker contract, default today).
    const [activeIndex, setActiveIndex] = useState<VegetationIndex | null>(null);
    // Soil view — colour parcels by soil class. Mutually exclusive with the
    // vegetation-index overlay (turning one on clears the other) so the map
    // never carries two competing data layers at once.
    const [soilView, setSoilView] = useState(false);
    const [imageryDate, setImageryDate] = useState<DateValue>(() => {
        const n = new Date();
        return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
    });
    // Merge: name-the-union modal (mirrors the draw → name-parcel flow).
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergeName, setMergeName] = useState('');
    const [merging, setMerging] = useState(false);
    const [mergeError, setMergeError] = useState<string | null>(null);

    const locQ = useTenantSWR<LocationDetail>(`/locations/${locationId}`);
    const parcelsQ = useTenantSWR<ParcelsResp>(`/locations/${locationId}/parcels`);
    const opsQ = useTenantSWR<OperationItem[]>(tab === 'operations' ? `/locations/${locationId}/operations` : null);
    // Generated ДНЕВНИК register — fetched on the Farm-records tab AND when the
    // generate modal is open (the modal shows the completeness affordance).
    const recordsQ = useTenantSWR<FarmRecordsResp>(
        tab === 'records' || showDnevnik ? `/locations/${locationId}/farm-records` : null,
    );
    // Recall + weather + crop-plan suggestions for this field (editable;
    // powers the spray-window/next-task banner + the wizard prefills).
    const smartQ = useTenantSWR<LocationSmartDefaults>(`/locations/${locationId}/smart-defaults`);
    // Active-index tiles (GEE) — fetched only when the Map tab is open AND an
    // index is selected, re-fetched when the index OR the inspection date
    // changes (the SWR key carries both). One query serves whichever of the
    // five indices is active; the route slug comes from the index config.
    const activeSpec = vegetationIndexById(activeIndex);
    const imageryYmd = toYMD(imageryDate);
    // Compact trigger label ("30 Jun", no year) so the index buttons + date
    // control stay narrow enough to sit on one row. UTC parts mirror the
    // date-utils UTC-midnight contract (no tz drift).
    const imageryShort = imageryDate
        ? `${imageryDate.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][imageryDate.getUTCMonth()]}`
        : t('dateFallback');
    const indexQ = useTenantSWR<{ configured: boolean; tileUrl: string; date?: string; error?: string }>(
        tab === 'map' && activeSpec
            ? `/agro/${activeSpec.route}?locationId=${locationId}${imageryYmd ? `&date=${imageryYmd}` : ''}`
            : null,
    );
    const indexConfigured = indexQ.data?.configured ?? true;
    const indexTileUrl = indexQ.data?.tileUrl ?? '';
    const indexLoading = !!activeSpec && !indexQ.data && !indexQ.error;

    const loc = locQ.data;
    const parcels = useMemo(() => parcelsQ.data?.parcels ?? [], [parcelsQ.data]);
    const totalAreaHa = useMemo(
        () => parcels.reduce((sum, p) => sum + (p.areaHa ?? 0), 0),
        [parcels],
    );
    const bounds = parcelsQ.data?.bounds ?? null;
    const mapParcels = useMemo<MapParcel[]>(
        () => parcels.map((p) => ({ id: p.id, name: p.name, areaHa: p.areaHa ?? null, geometry: (p.geometry ?? null) as Geometry | null })),
        [parcels],
    );

    // Crop-glyph overlay (#1): parcelId → crop value, plus the distinct set of
    // crops present (for the legend). cropType already flows from the parcels
    // API; the map draws a glyph per parcel that has one.
    const cropById = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const p of parcels) {
            if (p.cropType) map[p.id] = p.cropType;
        }
        return map;
    }, [parcels]);
    const cropsPresent = useMemo<string[]>(() => {
        const seen = new Set<string>();
        for (const p of parcels) {
            if (p.cropType) seen.add(p.cropType);
        }
        return Array.from(seen);
    }, [parcels]);

    const sheetParcel = useMemo<ParcelSheetData | null>(() => {
        const p = parcels.find((x) => x.id === sheetParcelId);
        return p
            ? {
                id: p.id,
                name: p.name,
                areaHa: p.areaHa ?? null,
                cropType: p.cropType ?? null,
                soilJson: p.soilJson ?? null,
            }
            : null;
    }, [parcels, sheetParcelId]);

    // Soil-view colouring: parcelId → class colour, plus the set of classes
    // present (for the legend) and whether any parcel is still "soil pending".
    const soilColorById = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const p of parcels) {
            const texture = p.soilJson?.textureClass ?? null;
            if (texture) map[p.id] = soilColorForTexture(texture);
        }
        return map;
    }, [parcels]);
    const soilClasses = useMemo<UsdaTextureClass[]>(() => {
        const seen = new Set<UsdaTextureClass>();
        for (const p of parcels) {
            const texture = p.soilJson?.textureClass ?? null;
            if (texture) seen.add(texture);
        }
        return Array.from(seen);
    }, [parcels]);
    const soilHasPending = useMemo(
        () => parcels.some((p) => !p.soilJson?.textureClass),
        [parcels],
    );

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

    // Set a parcel's crop from the Crop dropdown. Empty ⇒ clear (null).
    const setParcelCrop = useCallback(
        async (parcelId: string, cropType: string) => {
            await apiPatch(buildUrl(`/locations/${locationId}/parcels/${parcelId}`), {
                cropType: cropType || null,
            });
            await parcelsQ.mutate();
        },
        [buildUrl, locationId, parcelsQ],
    );

    const parcelColumns = useMemo(
        () =>
            createColumns<ParcelRow>([
                {
                    accessorKey: 'name',
                    header: t('colName'),
                    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
                    // Mobile (<sm) card heading.
                    meta: { mobileCard: { slot: 'title' } },
                },
                {
                    id: 'crop',
                    header: t('colCrop'),
                    cell: ({ row }) => (
                        <ParcelCropSelect
                            value={row.original.cropType ?? null}
                            onChange={(crop) => setParcelCrop(row.original.id, crop)}
                        />
                    ),
                    // Mobile card key/value row — the parcel's crop.
                    meta: { mobileCard: { slot: 'meta', label: t('colCrop') } },
                },
                {
                    id: 'areaHa',
                    header: t('colAreaHa'),
                    cell: ({ row }) => row.original.areaHa ?? '—',
                    // Mobile card key/value row — parcel area.
                    meta: { mobileCard: { slot: 'meta', label: t('colAreaHa') } },
                },
            ]),
        [setParcelCrop, t],
    );

    const downloadRecord = useCallback(
        async (fileRecordId: string, fileName: string) => {
            try {
                const res = await fetch(buildUrl(`/files/${fileRecordId}/download`));
                if (!res.ok) throw new Error('download failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch {
                toast.error(t('dnevnikDownloadFail'));
            }
        },
        [buildUrl, toast, t],
    );

    const recordColumns = useMemo(
        () =>
            createColumns<FarmRecordRow>([
                {
                    accessorKey: 'generatedAt',
                    header: t('colGeneratedAt'),
                    cell: ({ row }) => (
                        <span className="flex items-center gap-tight">
                            {formatDateTime(row.original.generatedAt)}
                            {row.index === 0 && <StatusBadge variant="success">{t('badgeCurrent')}</StatusBadge>}
                        </span>
                    ),
                    meta: { mobileCard: { slot: 'title' } },
                },
                {
                    id: 'period',
                    header: t('colPeriod'),
                    cell: ({ row }) => `${row.original.from} – ${row.original.to}`,
                    meta: { mobileCard: { slot: 'meta', label: t('colPeriod') } },
                },
                {
                    id: 'by',
                    header: t('colBy'),
                    cell: ({ row }) =>
                        row.original.auto ? t('byAuto') : (row.original.generatedByName ?? '—'),
                    meta: { mobileCard: { slot: 'meta', label: t('colBy') } },
                },
                {
                    accessorKey: 'sizeBytes',
                    header: t('colSize'),
                    cell: ({ row }) => `${(row.original.sizeBytes / 1024).toFixed(1)} KB`,
                    meta: { mobileCard: { slot: 'meta', label: t('colSize') } },
                },
                {
                    id: 'download',
                    header: '',
                    cell: ({ row }) => (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void downloadRecord(row.original.fileRecordId, row.original.fileName)}
                        >
                            {t('download')}
                        </Button>
                    ),
                },
            ]),
        [downloadRecord, t],
    );

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

    const tabs = [
        { key: 'overview' as const, label: t('tabOverview') },
        { key: 'map' as const, label: t('tabMap') },
        { key: 'operations' as const, label: t('tabOperations') },
        { key: 'records' as const, label: t('tabRecords') },
    ];

    const breadcrumbs: { label: string; href?: string }[] = [
        { label: tl('bcLocations'), href: `/t/${tenantSlug}/locations` },
        { label: loc?.name ?? t('fallbackTitle') },
    ];

    return (
        <EntityDetailLayout<Tab>
            breadcrumbs={breadcrumbs}
            back={{ smart: true }}
            title={loc?.name ?? t('fallbackTitle')}
            loading={locQ.isLoading && !loc}
            error={locQ.error ? t('loadError') : null}
            actions={
                <div className="flex items-center gap-compact">
                    <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>{t('importParcels')}</Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        icon={<CalendarIcon className="size-4" />}
                        onClick={() => setShowDnevnik(true)}
                        id="dnevnik-pdf-btn"
                    >
                        {t('dnevnikBtn')}
                    </Button>
                    <CoachMark
                        id="field-op-wizard"
                        title={t('coachTitle')}
                        body={t('coachBody')}
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
                            {t('sprayJob')}
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
                    {/* Compact info row below the tabs — just the two headline
                        figures (parcel count + total area). */}
                    <dl className="grid grid-cols-2 gap-default text-sm">
                        <div><dt className="text-content-secondary">{t('overviewParcels')}</dt><dd className="font-medium">{loc?._count?.parcels ?? parcels.length}</dd></div>
                        <div><dt className="text-content-secondary">{t('overviewTotalArea')}</dt><dd className="font-medium">{Math.round(totalAreaHa * 10) / 10} ha</dd></div>
                    </dl>
                    {loc?.description && <p className="text-sm">{loc.description}</p>}
                    {parcels.length === 0 && (
                        <div className="rounded-lg border border-border-subtle p-6 text-sm text-content-secondary">
                            {t('noParcelsHint')}
                        </div>
                    )}
                    {/* Parcels list — collapsible dropdown under the
                        Parcels / Total area row. */}
                    {parcels.length > 0 && (
                        <Accordion
                            type="single"
                            collapsible
                            className="rounded-lg border border-border-subtle"
                        >
                            <AccordionItem value="parcels" density="compact">
                                <AccordionTrigger size="sm" className="px-4">
                                    <span className="flex items-center gap-tight">
                                        <span className="font-medium">{t('parcelsAccordion')}</span>
                                        <span className="text-xs text-content-secondary">
                                            {loc?._count?.parcels ?? parcels.length}
                                        </span>
                                    </span>
                                </AccordionTrigger>
                                <AccordionContent size="sm">
                                    <DataTable<ParcelRow>
                                        data={parcels}
                                        columns={parcelColumns}
                                        getRowId={(p) => p.id}
                                        // <sm: render each parcel as a card. Tapping a
                                        // card opens the parcel bottom-sheet (area /
                                        // crop / apply-rate calc / "Start operation
                                        // here") — the same sheet a map tap opens.
                                        mobileFallback="card"
                                        onRowClick={(row) => setSheetParcelId(row.original.id)}
                                        loading={parcelsQ.isLoading && parcels.length === 0}
                                    />
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    )}
                </div>
            )}

            {tab === 'map' && (
                <div className="space-y-default">
                    <SmartDefaultsBanner data={smartQ.data} />
                    <div className="flex flex-wrap items-center gap-compact">
                        {/* Satellite index overlays (GEE) — the toggle row +
                            the shared inspection date sit together as one
                            left-aligned unit (date to the RIGHT of the
                            buttons), in the row position the Select/Draw/Edit/
                            Split toggle used to hold. Only one index is on at a
                            time (mutually exclusive); the single date picker
                            drives whichever is active. The buttons are
                            config-driven from VEGETATION_INDICES so adding an
                            index is one catalogue entry. */}
                        <div className="flex shrink-0 flex-wrap items-center gap-compact">
                            {VEGETATION_INDICES.map((idx) => {
                                const on = activeIndex === idx.id;
                                return (
                                    <Button
                                        key={idx.id}
                                        variant={on ? 'primary' : 'secondary'}
                                        size="sm"
                                        className="min-h-[44px] min-w-[44px]"
                                        onClick={() => {
                                            setActiveIndex((cur) => (cur === idx.id ? null : idx.id));
                                            setSoilView(false);
                                        }}
                                        aria-pressed={on}
                                    >
                                        {idx.label}
                                    </Button>
                                );
                            })}
                            {/* Soil view toggle — colours parcels by soil
                                class. Clears any active vegetation index so
                                only one data layer shows at a time. */}
                            <Button
                                variant={soilView ? 'primary' : 'secondary'}
                                size="sm"
                                className="min-h-[44px] min-w-[44px]"
                                onClick={() => {
                                    setSoilView((on) => {
                                        if (!on) setActiveIndex(null);
                                        return !on;
                                    });
                                }}
                                aria-pressed={soilView}
                            >
                                {tSoil('viewToggle')}
                            </Button>
                            {activeSpec && (
                                <DatePicker
                                    id="imagery-date-input"
                                    value={imageryDate}
                                    onChange={(d) => setImageryDate(d)}
                                    placeholder={t('dateFallback')}
                                    // The indices need a past satellite pass —
                                    // future dates have no imagery.
                                    disabledDays={{ after: new Date() }}
                                    // Compact trigger (icon + "30 Jun") keeps the
                                    // control narrow so it fits beside the toggles.
                                    trigger={({ open }) => (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="min-h-[44px] shrink-0"
                                            icon={<CalendarIcon className="size-4" aria-hidden="true" />}
                                            aria-haspopup="dialog"
                                            aria-expanded={open}
                                            aria-label={t('imageryAriaLabel', { date: imageryShort })}
                                        >
                                            {imageryShort}
                                        </Button>
                                    )}
                                />
                            )}
                        </div>
                        {selected.length >= 2 && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => { setMergeError(null); setMergeName(''); setMergeOpen(true); }}
                            >
                                {t('merge')}
                            </Button>
                        )}
                    </div>
                    {/* Active-index status line: loading / not-configured /
                        legend / error / no-imagery. Driven by the active
                        index's config (label, ramp, low/high captions). */}
                    {activeSpec && (
                        <div className="flex items-center gap-compact text-xs text-content-subtle">
                            {indexLoading ? (
                                <span>{t('loadingImagery', { index: activeSpec.label })}</span>
                            ) : indexConfigured === false ? (
                                <span>{t('imageryNotConfigured', { index: activeSpec.label })}</span>
                            ) : indexTileUrl ? (
                                <>
                                    <span className="font-medium text-content-secondary">{activeSpec.label}</span>
                                    <span>{activeSpec.lowLabel}</span>
                                    <span
                                        aria-hidden="true"
                                        className={cn('h-2 w-24 rounded-full', activeSpec.legendGradientClass)}
                                    />
                                    <span>{activeSpec.highLabel}</span>
                                </>
                            ) : indexQ.data?.error ? (
                                <span>{t('imageryLoadError', { index: activeSpec.label })}</span>
                            ) : (
                                <span>{t('imageryNone', { index: activeSpec.label })}</span>
                            )}
                        </div>
                    )}
                    <div className={cn('gap-section', !isMobile && 'grid grid-cols-1 md:grid-cols-[1fr_320px]')}>
                        <MapCanvas
                            parcels={mapParcels}
                            bounds={bounds}
                            selectedIds={selected}
                            onSelectionChange={handleMapSelection}
                            // Phone-native: thumb-reachable zoom + find-my-field
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
                            indexOverlay={
                                activeSpec && indexTileUrl
                                    ? { id: activeSpec.id, tileUrl: indexTileUrl }
                                    : null
                            }
                            // Read-only vector-tile source (perf at scale). The
                            // {z}/{x}/{y} placeholders are kept literal for
                            // MapLibre to substitute (buildUrl doesn't encode
                            // the path). This Map tab is interactive (select),
                            // so MapCanvas no-ops the vector source here — it
                            // only engages on pure read-only mounts. Passed so
                            // the prop is exercised + ready for a future
                            // read-only farm view.
                            vectorTileUrl={buildUrl(`/locations/${locationId}/tiles/{z}/{x}/{y}.pbf`)}
                            soilMode={soilView}
                            soilColorById={soilColorById}
                            cropById={cropById}
                        />
                        {/* Side column: crop legend (whenever crops are present)
                            + soil legend (soil view only). Both sit in the
                            desktop side column, or stack under the map on
                            phones. */}
                        {(cropsPresent.length > 0 || soilView) && (
                            <div className="space-y-default md:col-start-2">
                                {cropsPresent.length > 0 && <CropLegend crops={cropsPresent} />}
                                {soilView && <SoilLegend classes={soilClasses} hasPending={soilHasPending} />}
                            </div>
                        )}
                        {/* Spray-job panel — desktop-only; on phones the parcel
                            bottom-sheet replaces it. */}
                        {!isMobile && (
                            <div className="rounded-lg border border-border-subtle p-4">
                                <Heading level={3} className="mb-3">{t('newSprayJob')}</Heading>
                                <PrescriptionPanel
                                    locationId={locationId}
                                    tenantSlug={tenantSlug}
                                    selectedParcelIds={selected}
                                    onCreated={() => { setSelected([]); setTab('operations'); }}
                                />
                                {selected.length >= 2 && (
                                    <p className="mt-3 text-xs text-content-subtle">
                                        {t('parcelsSelectedMerge', { count: selected.length })}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === 'operations' && (
                <div className="space-y-section">
                    {(opsQ.data ?? []).length === 0 ? (
                        <div className="rounded-lg border border-border-subtle p-6 text-sm text-content-secondary">
                            {t('noSprayJobs')}
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
                                        <span className="text-xs text-content-secondary">{op.status} · {t('opParcels', { count: op._count?.operationParcels ?? 0 })}</span>
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

            {tab === 'records' && (
                <div className="space-y-section">
                    {(recordsQ.data?.records ?? []).length === 0 ? (
                        <div className="rounded-lg border border-border-subtle p-6 text-sm text-content-secondary">
                            {t('recordsNone')}
                        </div>
                    ) : (
                        <DataTable<FarmRecordRow>
                            data={recordsQ.data?.records ?? []}
                            columns={recordColumns}
                            getRowId={(r) => r.fileRecordId}
                            mobileFallback="card"
                            loading={recordsQ.isLoading && !recordsQ.data}
                        />
                    )}
                </div>
            )}

            <SpatialImportModal
                locationId={locationId}
                open={showImport}
                setOpen={setShowImport}
                onImported={({ parcelCount, skipped }) => {
                    toast.success(
                        t('importedToast', { count: parcelCount }) +
                            (skipped > 0 ? t('importedSkipped', { count: skipped }) : '') +
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
                showModal={mergeOpen}
                setShowModal={(v) => { if (!v) { setMergeOpen(false); setMergeName(''); setMergeError(null); } }}
                size="sm"
                title={t('mergeTitle')}
                description={t('mergeDescription')}
            >
                <Modal.Header title={t('mergeTitle')} description={t('mergeHeaderDescription', { count: selected.length })} />
                <Modal.Form id="merge-parcels-form" onSubmit={(e) => { e.preventDefault(); void mergeParcels(); }}>
                    <Modal.Body>
                        <FormField label={t('mergeFieldName')} required>
                            <Input value={mergeName} onChange={(e) => setMergeName(e.target.value)} placeholder={t('mergeNamePlaceholder')} />
                        </FormField>
                        {mergeError && (
                            <div role="alert" className="mt-3 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                                {mergeError}
                            </div>
                        )}
                    </Modal.Body>
                    <Modal.Actions>
                        <Button variant="secondary" size="sm" type="button" onClick={() => { setMergeOpen(false); setMergeName(''); setMergeError(null); }}>{tCommon('cancel')}</Button>
                        <Button variant="primary" size="sm" type="submit" loading={merging} disabled={selected.length < 2 || !mergeName.trim() || merging}>{t('mergeTitle')}</Button>
                    </Modal.Actions>
                </Modal.Form>
            </Modal>

            {/* БАБХ ДНЕВНИК (PDF) — pick a date range, download the filled diary. */}
            <Modal
                showModal={showDnevnik}
                setShowModal={(v) => { if (!v) setShowDnevnik(false); }}
                size="sm"
                title={t('dnevnikTitle')}
                description={t('dnevnikDescription')}
            >
                <Modal.Header
                    title={t('dnevnikTitle')}
                    description={t('dnevnikHeaderDescription')}
                />
                <Modal.Body>
                    <div className="space-y-default">
                        {(recordsQ.data?.completeness.missingLabels.length ?? 0) > 0 && (
                            <InlineNotice variant="warning">
                                {t('dnevnikMissing', { labels: recordsQ.data!.completeness.missingLabels.join(', ') })}{' '}
                                <a className="underline" href={tenantHref('/admin/farm-profile')}>
                                    {t('dnevnikFillProfile')}
                                </a>
                                .
                            </InlineNotice>
                        )}
                        <div className="flex flex-col gap-default sm:flex-row">
                            <FormField label={t('dnevnikFrom')}>
                                <DatePicker value={dnevnikFrom} onChange={(d) => d && setDnevnikFrom(d)} />
                            </FormField>
                            <FormField label={t('dnevnikTo')}>
                                <DatePicker value={dnevnikTo} onChange={(d) => d && setDnevnikTo(d)} />
                            </FormField>
                        </div>
                    </div>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="secondary" size="sm" type="button" onClick={() => setShowDnevnik(false)}>{t('dnevnikCancel')}</Button>
                    <Button variant="primary" size="sm" type="button" loading={dnevnikBusy} disabled={dnevnikBusy} onClick={() => void generateDnevnik()}>{t('dnevnikDownload')}</Button>
                </Modal.Actions>
            </Modal>
        </EntityDetailLayout>
    );
}
