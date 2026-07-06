'use client';

/**
 * Create / edit a grain contract.
 *
 * Modal-based form mounted inside the Contracts list so the table state,
 * filters, and scroll position survive opening the form. Dual-purpose:
 *   - no `contract` prop  → POST  /grain/contracts        (create)
 *   - `contract` provided → PATCH /grain/contracts/{id}   (edit)
 *
 * Form pattern (Epic 64-FORM, mirrors NewControlModal):
 *   - `useForm` + `zodResolver` for state + validation
 *   - `<FormField>` wraps each control
 *   - `register(...)` for plain inputs / textareas
 *   - `<Controller>` for the Combobox + DatePicker primitives
 *
 * Decimal magnitudes (volumeTonnes / pricePerTonne) are captured as text
 * inputs and coerced to `number | null` for the wire (the schema's
 * `NonNegativeNumber`). Season options are fetched from the PLANNING
 * seasons API (a grain tenant always also has PLANNING) — the select is
 * optional/clearable.
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
import {
    CONTRACT_STATUS_LABELS,
    CONTRACT_TYPE_LABELS,
} from './filter-defs';
import type { ContractRow } from './ContractsClient';

// ─── Options ─────────────────────────────────────────────────────────

const TYPE_OPTIONS: ComboboxOption[] = Object.entries(CONTRACT_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
);
const STATUS_OPTIONS: ComboboxOption[] = Object.entries(
    CONTRACT_STATUS_LABELS,
).map(([value, label]) => ({ value, label }));

interface SeasonOption {
    id: string;
    name: string;
}

// ─── Schema ──────────────────────────────────────────────────────────
//
// Client form contract. The server schema (`CreateContractSchema`) is the
// authority; this enforces the practical subset (counterparty required +
// non-negative numeric magnitudes). Numbers are typed as text and coerced
// on submit so an empty field maps to `null`, not `0`.

const numericText = z
    .string()
    .optional()
    .refine(
        (v) => v == null || v.trim() === '' || Number(v) >= 0,
        'Must be zero or positive',
    );

const formSchema = z.object({
    counterparty: z.string().min(1, 'Counterparty is required'),
    commodity: z.string().optional(),
    type: z.enum(['SALE', 'PURCHASE']),
    status: z.enum(['DRAFT', 'ACTIVE', 'DELIVERED', 'SETTLED', 'CANCELLED']),
    volumeTonnes: numericText,
    pricePerTonne: numericText,
    priceCurrency: z.string().max(8).optional(),
    deliveryStart: z.date().nullable(),
    deliveryEnd: z.date().nullable(),
    seasonId: z.string().optional(),
    terms: z.string().optional(),
    pricingNotes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const DEFAULT_VALUES: FormValues = {
    counterparty: '',
    commodity: '',
    type: 'SALE',
    status: 'DRAFT',
    volumeTonnes: '',
    pricePerTonne: '',
    priceCurrency: '',
    deliveryStart: null,
    deliveryEnd: null,
    seasonId: '',
    terms: '',
    pricingNotes: '',
};

/** Map a string|null decimal from the row into the form's text field. */
function decToText(v: string | null | undefined): string {
    return v == null ? '' : String(v);
}
/** Map a form text field back to `number | null` for the wire. */
function textToNum(v: string | undefined): number | null {
    if (v == null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
/** Map an ISO string|null into a Date|null for DatePicker. */
function isoToDate(v: string | null | undefined): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Component ───────────────────────────────────────────────────────

export interface ContractFormModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    /** When set, the modal edits this contract (PATCH); else it creates. */
    contract?: ContractRow | null;
    /** Called after a successful create/edit so the page can refetch. */
    onSaved?: () => void;
}

export function ContractFormModal({
    open,
    setOpen,
    tenantSlug,
    contract,
    onSaved,
}: ContractFormModalProps) {
    const t = useTranslations('grain.contracts.form');
    const apiUrl = useTenantApiUrl();
    const queryClient = useQueryClient();
    const isEdit = Boolean(contract);

    // Seasons for the optional season select. Fetched lazily when the
    // modal is open; a grain tenant always also has the PLANNING module.
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
    // Prepend a "No season" sentinel so the optional relation is
    // clearable (the Combobox has no built-in clear affordance).
    const seasonOptions: ComboboxOption[] = [
        { value: '', label: t('noSeason') },
        ...(seasonsQuery.data ?? []).map((s) => ({
            value: s.id,
            label: s.name,
        })),
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

    // Re-seed the form whenever the modal opens — from the edited contract
    // or back to empty defaults for create.
    useEffect(() => {
        if (!open) return;
        if (contract) {
            reset({
                counterparty: contract.counterparty,
                commodity: contract.commodity ?? '',
                type: contract.type,
                status: contract.status,
                volumeTonnes: decToText(contract.volumeTonnes),
                pricePerTonne: decToText(contract.pricePerTonne),
                priceCurrency: contract.priceCurrency ?? '',
                deliveryStart: isoToDate(contract.deliveryStart),
                deliveryEnd: isoToDate(contract.deliveryEnd),
                seasonId: contract.seasonId ?? '',
                terms: contract.terms ?? '',
                pricingNotes: contract.pricingNotes ?? '',
            });
        } else {
            reset(DEFAULT_VALUES);
        }
        const t = setTimeout(() => setFocus('counterparty'), 60);
        return () => clearTimeout(t);
    }, [open, contract, reset, setFocus]);

    const onSubmit = async (values: FormValues) => {
        try {
            const body = {
                counterparty: values.counterparty.trim(),
                commodity: values.commodity?.trim() || null,
                type: values.type,
                status: values.status,
                volumeTonnes: textToNum(values.volumeTonnes),
                pricePerTonne: textToNum(values.pricePerTonne),
                priceCurrency: values.priceCurrency?.trim() || null,
                deliveryStart: values.deliveryStart
                    ? values.deliveryStart.toISOString()
                    : null,
                deliveryEnd: values.deliveryEnd
                    ? values.deliveryEnd.toISOString()
                    : null,
                seasonId: values.seasonId || null,
                terms: values.terms?.trim() || null,
                pricingNotes: values.pricingNotes?.trim() || null,
            };
            const res = await fetch(
                isEdit
                    ? apiUrl(`/grain/contracts/${contract!.id}`)
                    : apiUrl('/grain/contracts'),
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
                          `Failed to ${isEdit ? 'update' : 'create'} contract`;
                throw new Error(msg);
            }
            queryClient.invalidateQueries({
                queryKey: ['grain-contracts', tenantSlug],
            });
            setOpen(false);
            onSaved?.();
        } catch (err) {
            setFormError('root.api', {
                type: 'api',
                message:
                    err instanceof Error
                        ? err.message
                        : `Failed to ${isEdit ? 'update' : 'create'} contract`,
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
                            id="contract-form-error"
                            role="alert"
                        >
                            {apiError}
                        </div>
                    )}

                    <div className="space-y-default">
                        <FormField
                            label={t('counterparty')}
                            required
                            error={errors.counterparty?.message}
                        >
                            <Input
                                id="contract-counterparty-input"
                                type="text"
                                placeholder={t('counterpartyPlaceholder')}
                                autoComplete="off"
                                {...register('counterparty')}
                            />
                        </FormField>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={t('type')} error={errors.type?.message}>
                                <Controller
                                    control={control}
                                    name="type"
                                    render={({ field }) => (
                                        <Combobox
                                            id="contract-type-input"
                                            name="type"
                                            options={TYPE_OPTIONS}
                                            selected={
                                                TYPE_OPTIONS.find(
                                                    (o) => o.value === field.value,
                                                ) ?? null
                                            }
                                            setSelected={(o) =>
                                                field.onChange(o?.value ?? 'SALE')
                                            }
                                            placeholder={t('typePlaceholder')}
                                            hideSearch
                                            matchTriggerWidth
                                            forceDropdown
                                            buttonProps={{ className: 'w-full' }}
                                            caret
                                        />
                                    )}
                                />
                            </FormField>
                            <FormField
                                label={t('status')}
                                error={errors.status?.message}
                            >
                                <Controller
                                    control={control}
                                    name="status"
                                    render={({ field }) => (
                                        <Combobox
                                            id="contract-status-input"
                                            name="status"
                                            options={STATUS_OPTIONS}
                                            selected={
                                                STATUS_OPTIONS.find(
                                                    (o) => o.value === field.value,
                                                ) ?? null
                                            }
                                            setSelected={(o) =>
                                                field.onChange(o?.value ?? 'DRAFT')
                                            }
                                            placeholder={t('statusPlaceholder')}
                                            hideSearch
                                            matchTriggerWidth
                                            forceDropdown
                                            buttonProps={{ className: 'w-full' }}
                                            caret
                                        />
                                    )}
                                />
                            </FormField>
                        </div>

                        <FormField
                            label={t('commodity')}
                            error={errors.commodity?.message}
                        >
                            <Input
                                id="contract-commodity-input"
                                type="text"
                                placeholder={t('commodityPlaceholder')}
                                autoComplete="off"
                                {...register('commodity')}
                            />
                        </FormField>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-3">
                            <FormField
                                label={t('volume')}
                                error={errors.volumeTonnes?.message}
                            >
                                <Input
                                    id="contract-volume-input"
                                    inputMode="decimal"
                                    placeholder={t('volumePlaceholder')}
                                    autoComplete="off"
                                    {...register('volumeTonnes')}
                                />
                            </FormField>
                            <FormField
                                label={t('price')}
                                error={errors.pricePerTonne?.message}
                            >
                                <Input
                                    id="contract-price-input"
                                    inputMode="decimal"
                                    placeholder={t('pricePlaceholder')}
                                    autoComplete="off"
                                    {...register('pricePerTonne')}
                                />
                            </FormField>
                            <FormField
                                label={t('currency')}
                                error={errors.priceCurrency?.message}
                            >
                                <Input
                                    id="contract-currency-input"
                                    type="text"
                                    placeholder={t('currencyPlaceholder')}
                                    autoComplete="off"
                                    {...register('priceCurrency')}
                                />
                            </FormField>
                        </div>

                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField
                                label={t('deliveryStart')}
                                error={errors.deliveryStart?.message}
                            >
                                <Controller
                                    control={control}
                                    name="deliveryStart"
                                    render={({ field }) => (
                                        <DatePicker
                                            id="contract-delivery-start-input"
                                            value={field.value}
                                            onChange={(d) => field.onChange(d)}
                                            placeholder={t('datePlaceholder')}
                                        />
                                    )}
                                />
                            </FormField>
                            <FormField
                                label={t('deliveryEnd')}
                                error={errors.deliveryEnd?.message}
                            >
                                <Controller
                                    control={control}
                                    name="deliveryEnd"
                                    render={({ field }) => (
                                        <DatePicker
                                            id="contract-delivery-end-input"
                                            value={field.value}
                                            onChange={(d) => field.onChange(d)}
                                            placeholder={t('datePlaceholder')}
                                        />
                                    )}
                                />
                            </FormField>
                        </div>

                        <FormField
                            label={t('season')}
                            hint={t('seasonHint')}
                            error={errors.seasonId?.message}
                        >
                            <Controller
                                control={control}
                                name="seasonId"
                                render={({ field }) => (
                                    <Combobox
                                        id="contract-season-input"
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
                                        forceDropdown
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                )}
                            />
                        </FormField>

                        <FormField label={t('terms')} error={errors.terms?.message}>
                            <Textarea
                                id="contract-terms-input"
                                rows={2}
                                placeholder={t('termsPlaceholder')}
                                {...register('terms')}
                            />
                        </FormField>

                        <FormField
                            label={t('pricingNotes')}
                            error={errors.pricingNotes?.message}
                        >
                            <Textarea
                                id="contract-pricing-notes-input"
                                rows={2}
                                placeholder={t('pricingNotesPlaceholder')}
                                {...register('pricingNotes')}
                            />
                        </FormField>
                    </div>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        id="contract-cancel-btn"
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
                        id="save-contract-btn"
                        loading={isSubmitting}
                    >
                        {isEdit ? t('saveContract') : t('createContract')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
