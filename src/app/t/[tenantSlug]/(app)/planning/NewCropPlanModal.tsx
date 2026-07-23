'use client';

/**
 * NewCropPlanModal — create a crop plan, then (optionally) generate its
 * plantings + field tasks in the same flow.
 *
 * The form captures the succession CONFIG the engine expands: season +
 * crop type + variety, planting method, first sow date, succession
 * count + interval, and a per-succession allocation (explicit plant
 * count). On submit it POSTs the plan; if "Generate plantings now" is
 * checked it then POSTs to the plan's /generate endpoint so the board
 * is populated immediately.
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiGet, apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';

interface SeasonOption {
    id: string;
    name: string;
}
interface CropTypeOption {
    id: string;
    name: string;
}
interface VarietyOption {
    id: string;
    name: string;
    cropType?: { id: string; name: string } | null;
    defaultMethod?: string | null;
}
interface LocationOption {
    id: string;
    name: string;
}
/** A parcel as returned by GET /locations/:id/parcels. */
interface ParcelRow {
    id: string;
    name: string;
    areaHa: number | null;
}

export interface NewCropPlanModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    seasons: SeasonOption[];
    cropTypes: CropTypeOption[];
    varieties: VarietyOption[];
    locations: LocationOption[];
    onSaved?: (plan: { id: string }) => void;
}

export function NewCropPlanModal({
    open,
    setOpen,
    seasons,
    cropTypes,
    varieties,
    locations,
    onSaved,
}: NewCropPlanModalProps) {
    const t = useTranslations('planning.newPlan');
    const buildUrl = useTenantApiUrl();

    const METHOD_OPTIONS: ComboboxOption[] = useMemo(
        () => [
            { value: 'DIRECT_SOW', label: t('methodDirectSow') },
            { value: 'TRANSPLANT', label: t('methodTransplant') },
        ],
        [t],
    );

    const [name, setName] = useState('');
    const [seasonId, setSeasonId] = useState('');
    const [cropTypeId, setCropTypeId] = useState('');
    const [cropVarietyId, setCropVarietyId] = useState('');
    const [locationId, setLocationId] = useState('');
    const [parcelId, setParcelId] = useState('');
    const [parcels, setParcels] = useState<ParcelRow[]>([]);
    const [parcelsLoading, setParcelsLoading] = useState(false);
    const [method, setMethod] = useState('DIRECT_SOW');
    const [firstSowDate, setFirstSowDate] = useState<Date | null>(new Date());
    const [successions, setSuccessions] = useState('1');
    const [intervalDays, setIntervalDays] = useState('0');
    const [plantsPerSuccession, setPlantsPerSuccession] = useState('');
    const [generateNow, setGenerateNow] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /* eslint-disable react-hooks/set-state-in-effect -- intentional form re-seed on open. */
    useEffect(() => {
        if (!open) return;
        setName('');
        setSeasonId(seasons[0]?.id ?? '');
        setCropTypeId('');
        setCropVarietyId('');
        setLocationId('');
        setParcelId('');
        setParcels([]);
        setMethod('DIRECT_SOW');
        setFirstSowDate(new Date());
        setSuccessions('1');
        setIntervalDays('0');
        setPlantsPerSuccession('');
        setGenerateNow(true);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const seasonOptions: ComboboxOption[] = useMemo(
        () => seasons.map((s) => ({ value: s.id, label: s.name })),
        [seasons],
    );
    const cropTypeOptions: ComboboxOption[] = useMemo(
        () => cropTypes.map((c) => ({ value: c.id, label: c.name })),
        [cropTypes],
    );
    // Varieties narrow to the chosen crop type once one is picked.
    const varietyOptions: ComboboxOption[] = useMemo(() => {
        const filtered = cropTypeId
            ? varieties.filter((v) => v.cropType?.id === cropTypeId)
            : varieties;
        return filtered.map((v) => ({ value: v.id, label: v.name }));
    }, [varieties, cropTypeId]);

    const locationOptions: ComboboxOption[] = useMemo(
        () => locations.map((l) => ({ value: l.id, label: l.name })),
        [locations],
    );

    // Fetch the chosen location's parcels on demand. Parcels are sorted by
    // area (largest first, per #2) so the picker leads with the big fields.
    useEffect(() => {
        if (!open || !locationId) {
            setParcels([]);
            return;
        }
        let cancelled = false;
        setParcelsLoading(true);
        apiGet<{ parcels: ParcelRow[] }>(buildUrl(`/locations/${locationId}/parcels?simplify=0.01`))
            .then((res) => {
                if (cancelled) return;
                const sorted = [...(res.parcels ?? [])].sort(
                    (a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0) || a.name.localeCompare(b.name),
                );
                setParcels(sorted);
            })
            .catch(() => {
                if (!cancelled) setParcels([]);
            })
            .finally(() => {
                if (!cancelled) setParcelsLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, locationId]);

    const parcelOptions: ComboboxOption[] = useMemo(
        () =>
            parcels.map((p) => ({
                value: p.id,
                label: p.areaHa != null ? `${p.name} (${p.areaHa} ha)` : p.name,
            })),
        [parcels],
    );

    // Picking a variety auto-fills the crop type + default method when
    // they aren't set yet (the variety is the more specific choice).
    const onVarietyChange = (id: string) => {
        setCropVarietyId(id);
        const v = varieties.find((x) => x.id === id);
        if (v) {
            if (v.cropType?.id) setCropTypeId(v.cropType.id);
            if (v.defaultMethod) setMethod(v.defaultMethod);
        }
    };

    const canSubmit =
        name.trim().length > 0 &&
        seasonId &&
        cropTypeId &&
        firstSowDate &&
        !submitting;

    const submit = async () => {
        if (!canSubmit || !firstSowDate) return;
        setSubmitting(true);
        setError(null);
        try {
            const plan = await apiPost<{ id: string }>(buildUrl('/planning/crop-plans'), {
                name: name.trim(),
                seasonId,
                cropTypeId,
                cropVarietyId: cropVarietyId || null,
                locationId: locationId || null,
                parcelId: parcelId || null,
                method,
                firstSowDate: firstSowDate.toISOString(),
                successions: Number(successions) || 1,
                intervalDays: Number(intervalDays) || 0,
                plantsPerSuccession:
                    plantsPerSuccession.trim() === '' ? null : Number(plantsPerSuccession),
            });
            // Generate the succession board only when a variety is chosen —
            // the engine needs a variety with days-to-maturity to schedule
            // (variety is optional on a plan, but Generate requires it). With
            // no variety we skip generation entirely and land the user on the
            // plan, where an inline hint guides them to add a variety + Generate.
            // A variety that lacks maturity still throws server-side
            // (CROP_PLAN_NOT_READY); we swallow it for the same reason — the
            // plan page's empty-state hint covers it — rather than flashing an
            // error that the immediate navigation would hide (the old bug:
            // setError then setOpen(false) on the same tick).
            if (generateNow && cropVarietyId) {
                try {
                    await apiPost(buildUrl(`/planning/crop-plans/${plan.id}/generate`), {});
                } catch {
                    /* Plan is created; the board's empty-state hint prompts
                       adding a maturity-bearing variety, then Generate. */
                }
            }
            setOpen(false);
            onSaved?.(plan);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('createFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const heading = t('heading');
    const description = t('description');

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="lg"
            title={heading}
            description={description}
            preventDefaultClose={submitting}
        >
            <Modal.Header title={heading} description={description} />
            <Modal.Form
                id="crop-plan-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                }}
            >
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="crop-plan-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    <fieldset disabled={submitting} className="m-0 p-0 border-0 space-y-default">
                        <FormField label={t('planName')} required>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('planNamePlaceholder')}
                                id="crop-plan-name"
                            />
                        </FormField>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                            <FormField label={t('season')} required>
                                <Combobox
                                    options={seasonOptions}
                                    selected={seasonOptions.find((o) => o.value === seasonId) ?? null}
                                    setSelected={(o) => setSeasonId(o?.value ?? '')}
                                    placeholder={seasonOptions.length ? t('selectSeason') : t('noSeasons')}
                                    aria-label={t('season')}
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label={t('cropType')} required>
                                <Combobox
                                    options={cropTypeOptions}
                                    selected={cropTypeOptions.find((o) => o.value === cropTypeId) ?? null}
                                    setSelected={(o) => {
                                        setCropTypeId(o?.value ?? '');
                                        // Clear a variety that no longer matches.
                                        setCropVarietyId('');
                                    }}
                                    placeholder={cropTypeOptions.length ? t('selectCrop') : t('noCrops')}
                                    aria-label={t('cropType')}
                                    matchTriggerWidth
                                />
                            </FormField>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                            <FormField label={t('variety')} hint={t('varietyHint')}>
                                <Combobox
                                    options={varietyOptions}
                                    selected={varietyOptions.find((o) => o.value === cropVarietyId) ?? null}
                                    setSelected={(o) => onVarietyChange(o?.value ?? '')}
                                    placeholder={varietyOptions.length ? t('selectVariety') : t('noVarieties')}
                                    aria-label={t('variety')}
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label={t('method')}>
                                <Combobox
                                    options={METHOD_OPTIONS}
                                    selected={METHOD_OPTIONS.find((o) => o.value === method) ?? null}
                                    setSelected={(o) => setMethod(o?.value ?? 'DIRECT_SOW')}
                                    aria-label={t('plantingMethod')}
                                    matchTriggerWidth
                                />
                            </FormField>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                            <FormField label={t('location')} hint={t('locationHint')}>
                                <Combobox
                                    options={locationOptions}
                                    selected={locationOptions.find((o) => o.value === locationId) ?? null}
                                    setSelected={(o) => {
                                        setLocationId(o?.value ?? '');
                                        // Clear a parcel from the previous location.
                                        setParcelId('');
                                    }}
                                    placeholder={locationOptions.length ? t('selectLocation') : t('noLocations')}
                                    aria-label={t('location')}
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label={t('parcel')} hint={t('parcelHint')}>
                                <Combobox
                                    options={parcelOptions}
                                    selected={parcelOptions.find((o) => o.value === parcelId) ?? null}
                                    setSelected={(o) => setParcelId(o?.value ?? '')}
                                    disabled={!locationId || parcelsLoading}
                                    placeholder={
                                        !locationId
                                            ? t('selectLocationFirst')
                                            : parcelsLoading
                                              ? t('loadingParcels')
                                              : parcelOptions.length
                                                ? t('selectParcel')
                                                : t('noParcels')
                                    }
                                    aria-label={t('parcel')}
                                    matchTriggerWidth
                                />
                            </FormField>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-default">
                            <FormField label={t('firstSowDate')} required>
                                <DatePicker
                                    value={firstSowDate}
                                    onChange={(d) => setFirstSowDate(d)}
                                    placeholder={t('selectDate')}
                                />
                            </FormField>
                            <FormField label={t('successions')} hint={t('successionsHint')}>
                                <Input
                                    inputMode="numeric"
                                    value={successions}
                                    onChange={(e) => setSuccessions(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="1"
                                    id="crop-plan-successions"
                                />
                            </FormField>
                            <FormField label={t('intervalDays')} hint={t('intervalHint')}>
                                <Input
                                    inputMode="numeric"
                                    value={intervalDays}
                                    onChange={(e) => setIntervalDays(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="0"
                                    id="crop-plan-interval"
                                />
                            </FormField>
                        </div>

                        <FormField
                            label={t('plantsPerSuccession')}
                            hint={t('plantsHint')}
                        >
                            <Input
                                inputMode="numeric"
                                value={plantsPerSuccession}
                                onChange={(e) => setPlantsPerSuccession(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder={t('plantsPlaceholder')}
                                id="crop-plan-plants"
                            />
                        </FormField>

                        <div className="space-y-tight">
                            <label className="flex items-center gap-tight text-sm text-content-default">
                                <input
                                    type="checkbox"
                                    checked={generateNow}
                                    onChange={(e) => setGenerateNow(e.target.checked)}
                                    id="crop-plan-generate-now"
                                />
                                {t('generateNow')}
                            </label>
                            {generateNow && !cropVarietyId && (
                                <p className="text-xs text-content-subtle" id="crop-plan-generate-hint">
                                    {t('generateNeedsVariety')}
                                </p>
                            )}
                        </div>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => setOpen(false)}
                        disabled={submitting}
                        id="crop-plan-cancel"
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!canSubmit}
                        loading={submitting}
                        id="crop-plan-submit"
                    >
                        {t('createPlan')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
