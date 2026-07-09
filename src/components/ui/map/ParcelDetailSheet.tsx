'use client';

/**
 * ParcelDetailSheet — the single spray/field-operation screen (#3).
 *
 * Tapping a parcel (on the map or the parcels list) opens this bottom-sheet,
 * which IS the create-operation form: an exclusive Fertilizer-XOR-Product
 * input selector, dose + unit, water carrier (product only), operator,
 * application technique, note, an editable parcel-crop selector, and a running
 * total from the shared rate-calc. Submits offline-first via `useOfflineSync`
 * (queued in the outbox with no signal, flushed on reconnect). Replaces the
 * old QR block + bespoke calculator + the multi-step SprayJobWizard.
 *
 * Built on the canonical {@link Sheet} primitive (`direction="bottom"`,
 * `modal={false}` so the map toolbar stays reachable).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { UserCombobox } from '@/components/ui/user-combobox';
import { SoilProfileCard } from '@/components/soil/SoilProfileCard';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useOfflineSync } from '@/lib/offline/use-offline-sync';
import { apiGet, apiPatch } from '@/lib/api-client';
import { haToDca, totalLabel, trimNumber } from '@/lib/agro/rate-calc';
import { CROP_OPTIONS, CROP_VALUES } from '@/lib/agriculture/crop-options';
import type { SoilProfile } from '@/lib/soil/types';
import type { LocationSmartDefaults } from '@/app-layer/usecases/smart-defaults';

interface ItemDTO {
    id: string;
    name: string;
    category: string;
    defaultUnit?: { id: string; symbol: string } | null;
}
interface UnitDTO {
    id: string;
    key: string;
    name: string;
    symbol: string;
    measure: string;
}
interface MeResponse {
    user?: { id?: string | null } | null;
}

export interface ParcelSheetData {
    id: string;
    name: string;
    areaHa?: number | null;
    cropType?: string | null;
    lastApplication?: { label: string; occurredAt?: string | null } | null;
    soilJson?: SoilProfile | null;
}

export interface ParcelDetailSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parcel: ParcelSheetData | null;
    locationId: string;
    /** Location smart-defaults (default unit, repeat-last) — optional. */
    smartDefaults?: LocationSmartDefaults | null;
    /** Called after a job is created (or queued offline) so the host can refresh. */
    onCreated?: (queued: boolean) => void;
    /** Called after the parcel's crop is changed inline so the host can refresh. */
    onCropChanged?: () => void;
}

type InputKind = 'PRODUCT' | 'FERTILIZER';

export function ParcelDetailSheet({
    open,
    onOpenChange,
    parcel,
    locationId,
    smartDefaults,
    onCreated,
    onCropChanged,
}: ParcelDetailSheetProps) {
    const t = useTranslations('ag.map');
    const tc = useTranslations('common');
    const buildUrl = useTenantApiUrl();
    const { tenantSlug } = useParams<{ tenantSlug: string }>();
    const { submit } = useOfflineSync();

    const { data: items } = useTenantSWR<ItemDTO[]>('/items');
    const { data: units } = useTenantSWR<UnitDTO[]>('/units?measure=RATE', {
        revalidateOnFocus: false,
        dedupingInterval: 60_000,
    });
    const { data: me } = useSWR<MeResponse>('/api/auth/me', apiGet);

    const [kind, setKind] = useState<InputKind>('PRODUCT');
    const [itemId, setItemId] = useState('');
    const [dose, setDose] = useState('');
    const [doseUnitId, setDoseUnitId] = useState('');
    const [waterRate, setWaterRate] = useState('');
    const [waterRateUnitId, setWaterRateUnitId] = useState('');
    const [technique, setTechnique] = useState('');
    const [note, setNote] = useState('');
    const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
    const [cropValue, setCropValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset the whole form whenever a different parcel takes the sheet.
    /* eslint-disable react-hooks/set-state-in-effect -- intentional form re-seed. */
    useEffect(() => {
        setKind('PRODUCT');
        setItemId('');
        setDose('');
        setDoseUnitId('');
        setWaterRate('');
        setWaterRateUnitId('');
        setTechnique('');
        setNote('');
        setError(null);
        setCropValue(parcel?.cropType ?? '');
    }, [parcel?.id, parcel?.cropType]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Default the assignee to the current operator once resolved (never clobber).
    useEffect(() => {
        if (open && me?.user?.id) setAssigneeUserId((prev) => prev ?? me.user?.id ?? null);
    }, [open, me?.user?.id]);

    // Prefill the default (most-recently-used) RATE unit for the dose.
    useEffect(() => {
        if (open && !doseUnitId && smartDefaults?.defaultUnitId) setDoseUnitId(smartDefaults.defaultUnitId);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill on open only
    }, [open, smartDefaults?.defaultUnitId]);

    // Default the water-carrier unit to L/dca (the standard tank rate).
    useEffect(() => {
        if (!open || waterRateUnitId) return;
        const lPerDca = (units ?? []).find((u) => u.symbol === 'L/dca');
        if (lPerDca) setWaterRateUnitId(lPerDca.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- default on open / units-resolve
    }, [open, units]);

    const itemOptions = useMemo<ComboboxOption<ItemDTO>[]>(() => {
        const pool = (items ?? []).filter((it) =>
            kind === 'FERTILIZER' ? it.category === 'FERTILIZER' : it.category !== 'FERTILIZER',
        );
        return pool.map((it) => ({ value: it.id, label: it.name, meta: it }));
    }, [items, kind]);
    const unitOptions = useMemo<ComboboxOption<UnitDTO>[]>(
        () => (units ?? []).map((u) => ({ value: u.id, label: u.symbol, meta: u })),
        [units],
    );
    const cropOptions = useMemo<ComboboxOption[]>(() => {
        // Keep an imported off-catalogue crop visible as a synthetic option.
        if (cropValue && !CROP_VALUES.has(cropValue)) {
            return [{ value: cropValue, label: cropValue }, ...CROP_OPTIONS];
        }
        return CROP_OPTIONS;
    }, [cropValue]);

    const kindOptions = useMemo<ComboboxOption[]>(
        () => [
            { value: 'PRODUCT', label: t('parcelSheet.kindProduct') },
            { value: 'FERTILIZER', label: t('parcelSheet.kindFertilizer') },
        ],
        [t],
    );

    const area = parcel?.areaHa ?? null;
    const areaHa = area ?? 0;
    const doseNumber = Number(dose);
    const doseValid = dose.trim() !== '' && Number.isFinite(doseNumber) && doseNumber > 0;
    const waterNumber = Number(waterRate);
    const waterValid = waterRate.trim() !== '' && Number.isFinite(waterNumber) && waterNumber > 0;
    const selectedUnit = unitOptions.find((o) => o.value === doseUnitId)?.meta ?? null;
    const selectedWaterUnit = unitOptions.find((o) => o.value === waterRateUnitId)?.meta ?? null;

    const areaSummary =
        areaHa > 0 ? `${trimNumber(areaHa)} ha · ${trimNumber(haToDca(areaHa))} dca` : null;
    const inputTotal =
        doseValid && selectedUnit && areaHa > 0 ? totalLabel(doseNumber, selectedUnit.symbol, areaHa) : null;
    const waterTotal =
        kind === 'PRODUCT' && waterValid && selectedWaterUnit && areaHa > 0
            ? totalLabel(waterNumber, selectedWaterUnit.symbol, areaHa)
            : null;

    const canSubmit = !!parcel && !!itemId && doseValid && !!doseUnitId && !!assigneeUserId && !submitting;

    const onCropChange = async (value: string) => {
        if (!parcel || value === cropValue) return;
        setCropValue(value);
        try {
            await apiPatch(buildUrl(`/locations/${locationId}/parcels/${parcel.id}`), { cropType: value || null });
            onCropChanged?.();
        } catch {
            // Non-blocking — the crop edit is a side action; surface nothing loud.
            setCropValue(parcel.cropType ?? '');
        }
    };

    const doSubmit = async () => {
        if (!canSubmit || !parcel) return;
        setSubmitting(true);
        setError(null);
        try {
            const isFertilizer = kind === 'FERTILIZER';
            const result = await submit({
                url: buildUrl(`/locations/${locationId}/operations`),
                method: 'POST',
                body: {
                    operationType: isFertilizer ? 'FERTILIZE' : 'SPRAY',
                    assigneeUserId,
                    parcelIds: [parcel.id],
                    ...(isFertilizer
                        ? { fertilizerItemId: itemId, fertilizerDoseValue: doseNumber, fertilizerDoseUnitId: doseUnitId }
                        : {
                              productItemId: itemId,
                              doseValue: doseNumber,
                              doseUnitId,
                              waterRateValue: waterValid ? waterNumber : null,
                              waterRateUnitId: waterValid ? waterRateUnitId : null,
                          }),
                    applicationTechnique: technique.trim() || null,
                    targetNote: note.trim() || null,
                },
                label: t('parcelSheet.createOperation'),
            });
            onOpenChange(false);
            onCreated?.(result === 'queued');
        } catch (err) {
            setError(err instanceof Error ? err.message : t('parcelSheet.createFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            direction="bottom"
            modal={false}
            title={parcel?.name ?? t('parcel')}
            description={t('parcelSheet.description')}
        >
            <Sheet.Header title={parcel?.name ?? t('parcel')} />
            <Sheet.Body className="space-y-section">
                {error && (
                    <div role="alert" className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                        {error}
                    </div>
                )}

                {/* Parcel summary + editable crop. */}
                <dl className="grid grid-cols-2 gap-default text-sm">
                    <div>
                        <dt className="text-content-secondary">{t('parcelSheet.area')}</dt>
                        <dd className="font-medium" data-testid="parcel-sheet-area">
                            {areaSummary ?? '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-content-secondary">{t('parcelSheet.crop')}</dt>
                        <dd data-testid="parcel-sheet-crop">
                            <Combobox
                                options={cropOptions}
                                selected={cropOptions.find((o) => o.value === cropValue) ?? null}
                                setSelected={(o) => void onCropChange(o?.value ?? '')}
                                placeholder={t('parcelSheet.selectCrop')}
                                aria-label={t('parcelSheet.crop')}
                                matchTriggerWidth
                            />
                        </dd>
                    </div>
                </dl>

                <div className="rounded-lg border border-border-subtle p-4">
                    <SoilProfileCard profile={parcel?.soilJson ?? null} />
                </div>

                {/* The create-operation form — one exclusive input kind. Only
                    mounted with a parcel so the operator picker (react-query)
                    never renders while the sheet is closed. */}
                {parcel && (
                <div className="space-y-default rounded-lg border border-border-subtle p-4">
                    <p className="text-sm font-medium text-content-emphasis">{t('parcelSheet.newOperation')}</p>

                    <FormField label={t('parcelSheet.inputKind')}>
                        <ToggleGroup
                            size="sm"
                            ariaLabel={t('parcelSheet.inputKind')}
                            selected={kind}
                            selectAction={(v) => {
                                setKind(v as InputKind);
                                setItemId('');
                            }}
                            options={kindOptions}
                        />
                    </FormField>

                    <FormField label={kind === 'FERTILIZER' ? t('parcelSheet.fertilizer') : t('parcelSheet.product')} required>
                        <Combobox
                            options={itemOptions}
                            selected={itemOptions.find((o) => o.value === itemId) ?? null}
                            setSelected={(o) => setItemId(o?.value ?? '')}
                            placeholder={
                                itemOptions.length
                                    ? kind === 'FERTILIZER'
                                        ? t('parcelSheet.selectFertilizer')
                                        : t('parcelSheet.selectProduct')
                                    : t('parcelSheet.noItems')
                            }
                            aria-label={kind === 'FERTILIZER' ? t('parcelSheet.fertilizer') : t('parcelSheet.product')}
                            matchTriggerWidth
                        />
                    </FormField>

                    <div className="grid grid-cols-2 gap-default">
                        <FormField label={t('parcelSheet.dose')} required>
                            <Input
                                inputMode="decimal"
                                value={dose}
                                onChange={(e) => setDose(e.target.value)}
                                placeholder={t('parcelSheet.dosePlaceholder')}
                                id="parcel-sheet-dose"
                            />
                        </FormField>
                        <FormField label={t('parcelSheet.unit')} required>
                            <Combobox
                                options={unitOptions}
                                selected={unitOptions.find((o) => o.value === doseUnitId) ?? null}
                                setSelected={(o) => setDoseUnitId(o?.value ?? '')}
                                placeholder={t('parcelSheet.unit')}
                                aria-label={t('parcelSheet.unit')}
                                matchTriggerWidth
                            />
                        </FormField>
                    </div>

                    {inputTotal && (
                        <p className="text-sm text-content-secondary" aria-live="polite" data-testid="parcel-sheet-total">
                            {t('parcelSheet.totalNeeded', { total: inputTotal })}
                        </p>
                    )}

                    {kind === 'PRODUCT' && (
                        <div className="grid grid-cols-2 gap-default">
                            <FormField label={t('parcelSheet.water')} hint={t('parcelSheet.waterHint')}>
                                <Input
                                    inputMode="decimal"
                                    value={waterRate}
                                    onChange={(e) => setWaterRate(e.target.value)}
                                    placeholder={t('parcelSheet.dosePlaceholder')}
                                    id="parcel-sheet-water"
                                />
                            </FormField>
                            <FormField label={t('parcelSheet.unit')}>
                                <Combobox
                                    options={unitOptions}
                                    selected={unitOptions.find((o) => o.value === waterRateUnitId) ?? null}
                                    setSelected={(o) => setWaterRateUnitId(o?.value ?? '')}
                                    placeholder={t('parcelSheet.unit')}
                                    aria-label={t('parcelSheet.waterUnit')}
                                    matchTriggerWidth
                                />
                            </FormField>
                        </div>
                    )}
                    {waterTotal && (
                        <p className="text-xs text-content-subtle" aria-live="polite">
                            {t('parcelSheet.waterNeeded', { total: waterTotal })}
                        </p>
                    )}

                    <FormField label={t('parcelSheet.operator')} required>
                        <UserCombobox
                            id="parcel-sheet-operator"
                            name="assigneeUserId"
                            tenantSlug={tenantSlug}
                            selectedId={assigneeUserId}
                            onChange={(id) => setAssigneeUserId(id)}
                            placeholder={t('parcelSheet.operatorPlaceholder')}
                            matchTriggerWidth
                        />
                    </FormField>

                    <FormField label={t('parcelSheet.technique')} hint={t('parcelSheet.techniqueHint')}>
                        <Input
                            value={technique}
                            onChange={(e) => setTechnique(e.target.value)}
                            placeholder={t('parcelSheet.techniquePlaceholder')}
                            id="parcel-sheet-technique"
                        />
                    </FormField>

                    <FormField label={t('parcelSheet.note')}>
                        <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={t('parcelSheet.notePlaceholder')}
                            id="parcel-sheet-note"
                        />
                    </FormField>
                </div>
                )}

            </Sheet.Body>
            {parcel && (
                <Sheet.Actions align="between">
                    <Sheet.Close asChild>
                        <Button variant="secondary" size="lg">{tc('close')}</Button>
                    </Sheet.Close>
                    <Button
                        variant="primary"
                        size="lg"
                        data-testid="parcel-sheet-start-operation"
                        loading={submitting}
                        disabled={!canSubmit}
                        onClick={() => void doSubmit()}
                    >
                        {t('parcelSheet.createOperation')}
                    </Button>
                </Sheet.Actions>
            )}
        </Sheet>
    );
}

export default ParcelDetailSheet;
