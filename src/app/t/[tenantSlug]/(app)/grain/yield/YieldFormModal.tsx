'use client';

/**
 * Create / edit a grain yield record (actual harvest production).
 *
 * Dual-purpose modal mounted inside the Yield list:
 *   - no `record` prop  → POST  /grain/yield-records        (create)
 *   - `record` provided → PATCH /grain/yield-records/{id}   (edit)
 *
 * Captures the gross tonnes realised against a planting / field / season
 * with the moisture basis + area (the server derives t/ha). All three FK
 * relations are optional/clearable comboboxes, fetched lazily on open
 * (plantings + locations + seasons). Numeric magnitudes are captured as
 * text and coerced to `number | null` on the wire.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    useEffect,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { YieldRow } from './YieldClient';

interface PlantingOption {
    id: string;
    successionNumber: number;
    variety?: { id: string; name: string } | null;
    location?: { id: string; name: string } | null;
}
interface LocationOption {
    id: string;
    name: string;
}
interface SeasonOption {
    id: string;
    name: string;
}

const numericText = z
    .string()
    .optional()
    .refine(
        (v) => v == null || v.trim() === '' || Number(v) >= 0,
        'Must be zero or positive',
    );

const formSchema = z.object({
    commodity: z.string().optional(),
    harvestedAt: z.date().nullable(),
    grossTonnes: numericText,
    moisturePct: numericText,
    areaHa: numericText,
    plantingId: z.string().optional(),
    locationId: z.string().optional(),
    seasonId: z.string().optional(),
    valuationNotes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const DEFAULT_VALUES: FormValues = {
    commodity: '',
    harvestedAt: null,
    grossTonnes: '',
    moisturePct: '',
    areaHa: '',
    plantingId: '',
    locationId: '',
    seasonId: '',
    valuationNotes: '',
};

function textToNum(v: string | undefined): number | null {
    if (v == null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function numToText(v: number | null | undefined): string {
    return v == null ? '' : String(v);
}
function isoToDate(v: string | null | undefined): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

export interface YieldFormModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    /** When set, the modal edits this record (PATCH); else it creates. */
    record?: YieldRow | null;
    onSaved?: () => void;
}

export function YieldFormModal({
    open,
    setOpen,
    tenantSlug,
    record,
    onSaved,
}: YieldFormModalProps) {
    const t = useTranslations('grain.yield.form');
    const apiUrl = useTenantApiUrl();
    const queryClient = useQueryClient();
    const isEdit = Boolean(record);

    // FK option sources — fetched lazily when the modal opens.
    const plantingsQuery = useQuery<PlantingOption[]>({
        queryKey: ['grain', tenantSlug, 'plantings'],
        queryFn: async () => {
            const res = await fetch(apiUrl('/planning/plantings'));
            if (!res.ok) throw new Error('Failed to load plantings');
            return res.json();
        },
        enabled: open,
        staleTime: 60_000,
    });
    const locationsQuery = useQuery<LocationOption[]>({
        queryKey: ['grain', tenantSlug, 'locations'],
        queryFn: async () => {
            const res = await fetch(apiUrl('/locations'));
            if (!res.ok) throw new Error('Failed to load locations');
            return res.json();
        },
        enabled: open,
        staleTime: 60_000,
    });
    const seasonsQuery = useQuery<SeasonOption[]>({
        queryKey: ['grain', tenantSlug, 'seasons'],
        queryFn: async () => {
            const res = await fetch(apiUrl('/planning/seasons'));
            if (!res.ok) throw new Error('Failed to load seasons');
            return res.json();
        },
        enabled: open,
        staleTime: 60_000,
    });

    // "No X" sentinels make the optional relations clearable (the Combobox
    // has no built-in clear affordance).
    const plantingOptions: ComboboxOption[] = [
        { value: '', label: t('noPlanting') },
        ...(plantingsQuery.data ?? []).map((p) => ({
            value: p.id,
            label: `${t('successionLabel', { n: p.successionNumber })}${
                p.variety?.name ? ` · ${p.variety.name}` : ''
            }`,
        })),
    ];
    const locationOptions: ComboboxOption[] = [
        { value: '', label: t('noField') },
        ...(locationsQuery.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    ];
    const seasonOptions: ComboboxOption[] = [
        { value: '', label: t('noSeason') },
        ...(seasonsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name })),
    ];

    const {
        register,
        handleSubmit,
        control,
        reset,
        setError: setFormError,
        setFocus,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: DEFAULT_VALUES,
        mode: 'onTouched',
    });

    useEffect(() => {
        if (!open) return;
        if (record) {
            reset({
                commodity: record.commodity ?? '',
                harvestedAt: isoToDate(record.harvestedAt),
                grossTonnes: numToText(record.grossTonnes),
                moisturePct: numToText(record.moisturePct),
                areaHa: numToText(record.areaHa),
                plantingId: record.plantingId ?? '',
                locationId: record.locationId ?? '',
                seasonId: record.seasonId ?? '',
                valuationNotes: record.valuationNotes ?? '',
            });
        } else {
            reset(DEFAULT_VALUES);
        }
        const t = setTimeout(() => setFocus('commodity'), 60);
        return () => clearTimeout(t);
    }, [open, record, reset, setFocus]);

    const onSubmit = async (values: FormValues) => {
        try {
            const body = {
                commodity: values.commodity?.trim() || null,
                harvestedAt: values.harvestedAt
                    ? values.harvestedAt.toISOString()
                    : null,
                grossTonnes: textToNum(values.grossTonnes),
                moisturePct: textToNum(values.moisturePct),
                areaHa: textToNum(values.areaHa),
                plantingId: values.plantingId || null,
                locationId: values.locationId || null,
                seasonId: values.seasonId || null,
                valuationNotes: values.valuationNotes?.trim() || null,
            };
            const res = await fetch(
                isEdit
                    ? apiUrl(`/grain/yield-records/${record!.id}`)
                    : apiUrl('/grain/yield-records'),
                {
                    method: isEdit ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg =
                    typeof data.error === 'string'
                        ? data.error
                        : data.message ||
                          `Failed to ${isEdit ? 'update' : 'create'} yield record`;
                throw new Error(msg);
            }
            queryClient.invalidateQueries({
                queryKey: ['grain-yield', tenantSlug],
            });
            setOpen(false);
            onSaved?.();
        } catch (err) {
            setFormError('root.api', {
                type: 'api',
                message:
                    err instanceof Error
                        ? err.message
                        : `Failed to ${isEdit ? 'update' : 'create'} yield record`,
            });
        }
    };

    const apiError = errors.root?.api?.message;
    const heading = isEdit ? t('editTitle') : t('newTitle');
    const description = isEdit ? t('editDescription') : t('newDescription');

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="lg"
            title={heading}
            description={description}
            preventDefaultClose={isSubmitting}
        >
            <Modal.Header title={heading} description={description} />
            <Modal.Form onSubmit={handleSubmit(onSubmit)}>
                <Modal.Body>
                    {apiError && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="yield-form-error"
                            role="alert"
                        >
                            {apiError}
                        </div>
                    )}

                    <div className="space-y-default">
                        <FormField
                            label={t('commodity')}
                            error={errors.commodity?.message}
                        >
                            <Input
                                id="yield-commodity-input"
                                type="text"
                                placeholder={t('commodityPlaceholder')}
                                autoComplete="off"
                                {...register('commodity')}
                            />
                        </FormField>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField
                                label={t('harvestedAt')}
                                error={errors.harvestedAt?.message}
                            >
                                <Controller
                                    control={control}
                                    name="harvestedAt"
                                    render={({ field }) => (
                                        <DatePicker
                                            id="yield-harvested-at-input"
                                            value={field.value}
                                            onChange={(d) => field.onChange(d)}
                                            placeholder={t('datePlaceholder')}
                                        />
                                    )}
                                />
                            </FormField>
                            <FormField
                                label={t('grossTonnes')}
                                error={errors.grossTonnes?.message}
                            >
                                <Input
                                    id="yield-gross-tonnes-input"
                                    inputMode="decimal"
                                    placeholder={t('grossPlaceholder')}
                                    autoComplete="off"
                                    {...register('grossTonnes')}
                                />
                            </FormField>
                        </div>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField
                                label={t('moisture')}
                                error={errors.moisturePct?.message}
                            >
                                <Input
                                    id="yield-moisture-input"
                                    inputMode="decimal"
                                    placeholder={t('moisturePlaceholder')}
                                    autoComplete="off"
                                    {...register('moisturePct')}
                                />
                            </FormField>
                            <FormField
                                label={t('area')}
                                error={errors.areaHa?.message}
                            >
                                <Input
                                    id="yield-area-input"
                                    inputMode="decimal"
                                    placeholder={t('areaPlaceholder')}
                                    autoComplete="off"
                                    {...register('areaHa')}
                                />
                            </FormField>
                        </div>

                        <FormField
                            label={t('planting')}
                            hint={t('plantingHint')}
                            error={errors.plantingId?.message}
                        >
                            <Controller
                                control={control}
                                name="plantingId"
                                render={({ field }) => (
                                    <Combobox
                                        id="yield-planting-input"
                                        name="plantingId"
                                        options={plantingOptions}
                                        selected={
                                            plantingOptions.find(
                                                (o) => o.value === field.value,
                                            ) ?? null
                                        }
                                        setSelected={(o) =>
                                            field.onChange(o?.value ?? '')
                                        }
                                        placeholder={t('plantingPlaceholder')}
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                )}
                            />
                        </FormField>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField
                                label={t('field')}
                                error={errors.locationId?.message}
                            >
                                <Controller
                                    control={control}
                                    name="locationId"
                                    render={({ field }) => (
                                        <Combobox
                                            id="yield-location-input"
                                            name="locationId"
                                            options={locationOptions}
                                            selected={
                                                locationOptions.find(
                                                    (o) => o.value === field.value,
                                                ) ?? null
                                            }
                                            setSelected={(o) =>
                                                field.onChange(o?.value ?? '')
                                            }
                                            placeholder={t('fieldPlaceholder')}
                                            matchTriggerWidth
                                            buttonProps={{ className: 'w-full' }}
                                            caret
                                        />
                                    )}
                                />
                            </FormField>
                            <FormField
                                label={t('season')}
                                error={errors.seasonId?.message}
                            >
                                <Controller
                                    control={control}
                                    name="seasonId"
                                    render={({ field }) => (
                                        <Combobox
                                            id="yield-season-input"
                                            name="seasonId"
                                            options={seasonOptions}
                                            selected={
                                                seasonOptions.find(
                                                    (o) => o.value === field.value,
                                                ) ?? null
                                            }
                                            setSelected={(o) =>
                                                field.onChange(o?.value ?? '')
                                            }
                                            placeholder={t('seasonPlaceholder')}
                                            matchTriggerWidth
                                            buttonProps={{ className: 'w-full' }}
                                            caret
                                        />
                                    )}
                                />
                            </FormField>
                        </div>

                        <FormField
                            label={t('valuationNotes')}
                            error={errors.valuationNotes?.message}
                        >
                            <Textarea
                                id="yield-valuation-notes-input"
                                rows={2}
                                placeholder={t('valuationPlaceholder')}
                                {...register('valuationNotes')}
                            />
                        </FormField>
                    </div>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        id="yield-cancel-btn"
                        onClick={() => {
                            if (!isSubmitting) setOpen(false);
                        }}
                        disabled={isSubmitting}
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        id="save-yield-btn"
                        loading={isSubmitting}
                    >
                        {isEdit ? t('saveYield') : t('createYield')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
