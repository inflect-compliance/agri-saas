'use client';

/**
 * JournalEntryModal — create / edit a field-journal entry.
 *
 * Carries the full LogEntry authoring surface: type, status, date,
 * title, TipTap rich-text notes, farmOS quantity lines (measure +
 * value + unit + label), and Location links. Mirrors the Modal.Form
 * shell + unsaved-changes guard used by NewAssetModal / NewLocationModal.
 *
 * The RichTextEditor (Tiptap + ProseMirror) is lazy-loaded via
 * next/dynamic so its ~200KB chunk only lands when the modal opens.
 */

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { apiPost, apiPatch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Plus, Trash } from '@/components/ui/icons/nucleo';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { SkeletonCard } from '@/components/ui/skeleton';
import {
    LOG_ENTRY_TYPE_LABELS,
    LOG_ENTRY_STATUS_LABELS,
} from './filter-defs';

const RichTextEditor = dynamic(
    () => import('@/components/ui/RichTextEditor').then((m) => m.RichTextEditor),
    { ssr: false, loading: () => <SkeletonCard lines={4} /> },
);

const QUANTITY_MEASURES = ['COUNT', 'WEIGHT', 'VOLUME', 'AREA', 'LENGTH', 'RATE', 'OTHER'] as const;
type QuantityMeasure = (typeof QUANTITY_MEASURES)[number];

interface UnitOption {
    id: string;
    name: string;
    symbol: string;
    measure: string;
}

interface LocationOption {
    id: string;
    name: string;
}

interface ItemOption {
    id: string;
    name: string;
    category: string;
}

interface QuantityRow {
    measure: QuantityMeasure;
    value: string;
    unitId: string;
    label: string;
}

/**
 * Optional harvest-output payload (HARVEST entries only). The server mints a
 * HARVEST_IN lot of `itemId` and records genealogy when this is present.
 */
interface HarvestPayload {
    itemId: string;
    quantity: number;
    lotCode?: string | null;
}

interface JournalSubmitBody {
    type: string;
    status: string;
    occurredAt: string | null;
    title: string;
    notes: string | null;
    quantities: Array<{ measure: QuantityMeasure; value: number; unitId: string; label: string | null }>;
    locationIds: string[];
    harvest?: HarvestPayload;
}

export interface JournalEntryInitial {
    id?: string;
    type?: string;
    status?: string;
    occurredAt?: string | null;
    title?: string;
    notes?: string | null;
    quantities?: Array<{ measure: string; value: number | string; unitId: string; label?: string | null }>;
    locationIds?: string[];
}

export interface JournalEntryModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    /** When provided the modal is in EDIT mode and PATCHes this entry. */
    initial?: JournalEntryInitial;
    onSaved?: (entry: { id: string }) => void;
}

const TYPE_OPTIONS: ComboboxOption[] = Object.entries(LOG_ENTRY_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
);
const STATUS_OPTIONS: ComboboxOption[] = Object.entries(LOG_ENTRY_STATUS_LABELS).map(
    ([value, label]) => ({ value, label }),
);

export function JournalEntryModal({ open, setOpen, tenantSlug, initial, onSaved }: JournalEntryModalProps) {
    const buildUrl = useTenantApiUrl();
    const isEdit = !!initial?.id;

    // Catalogs for the pickers.
    // Units are a slow-changing catalog — relax SWR revalidation.
    const { data: units } = useTenantSWR<UnitOption[]>(open ? '/units' : null, {
        revalidateOnFocus: false,
        dedupingInterval: 60_000,
    });
    const { data: locations } = useTenantSWR<LocationOption[]>(open ? '/locations' : null);
    // Items catalog — backs the optional harvest-output picker (HARVEST only).
    const { data: items } = useTenantSWR<ItemOption[]>(open ? '/items' : null);

    // ── Form state ──
    const [type, setType] = useState<string>(initial?.type ?? 'ACTIVITY');
    const [status, setStatus] = useState<string>(initial?.status ?? 'DONE');
    const [occurredAt, setOccurredAt] = useState<Date | null>(
        initial?.occurredAt ? new Date(initial.occurredAt) : new Date(),
    );
    const [title, setTitle] = useState(initial?.title ?? '');
    const [notes, setNotes] = useState(initial?.notes ?? '');
    const [quantities, setQuantities] = useState<QuantityRow[]>(
        (initial?.quantities ?? []).map((q) => ({
            measure: (q.measure as QuantityMeasure) ?? 'COUNT',
            value: String(q.value ?? ''),
            unitId: q.unitId ?? '',
            label: q.label ?? '',
        })),
    );
    const [locationIds, setLocationIds] = useState<string[]>(initial?.locationIds ?? []);
    // Harvest-output state — only consumed when type === 'HARVEST'. Editing an
    // existing entry never re-mints a lot, so these reset to empty on open.
    const [harvestItemId, setHarvestItemId] = useState<string>('');
    const [harvestQty, setHarvestQty] = useState<string>('');
    const [harvestLotCode, setHarvestLotCode] = useState<string>('');
    const [dirty, setDirty] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-seed the form whenever the modal (re)opens with a new `initial`.
    /* eslint-disable react-hooks/set-state-in-effect -- intentional form re-seed on open. */
    useEffect(() => {
        if (!open) return;
        setType(initial?.type ?? 'ACTIVITY');
        setStatus(initial?.status ?? 'DONE');
        setOccurredAt(initial?.occurredAt ? new Date(initial.occurredAt) : new Date());
        setTitle(initial?.title ?? '');
        setNotes(initial?.notes ?? '');
        setQuantities(
            (initial?.quantities ?? []).map((q) => ({
                measure: (q.measure as QuantityMeasure) ?? 'COUNT',
                value: String(q.value ?? ''),
                unitId: q.unitId ?? '',
                label: q.label ?? '',
            })),
        );
        setLocationIds(initial?.locationIds ?? []);
        setHarvestItemId('');
        setHarvestQty('');
        setHarvestLotCode('');
        setDirty(false);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initial?.id]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const unitOptions: ComboboxOption[] = useMemo(
        () => (units ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.symbol})` })),
        [units],
    );
    const locationOptions: ComboboxOption[] = useMemo(
        () => (locations ?? []).map((l) => ({ value: l.id, label: l.name })),
        [locations],
    );
    // Harvest item options — surface HARVESTED_PRODUCE first (the expected
    // output category) but keep every item selectable.
    const harvestItemOptions: ComboboxOption[] = useMemo(() => {
        const all = items ?? [];
        const produce = all.filter((i) => i.category === 'HARVESTED_PRODUCE');
        const rest = all.filter((i) => i.category !== 'HARVESTED_PRODUCE');
        return [...produce, ...rest].map((i) => ({ value: i.id, label: i.name }));
    }, [items]);

    const markDirty = () => setDirty(true);

    const addQuantity = () => {
        setQuantities((qs) => [...qs, { measure: 'COUNT', value: '', unitId: '', label: '' }]);
        markDirty();
    };
    const updateQuantity = (i: number, patch: Partial<QuantityRow>) => {
        setQuantities((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
        markDirty();
    };
    const removeQuantity = (i: number) => {
        setQuantities((qs) => qs.filter((_, idx) => idx !== i));
        markDirty();
    };

    const canSubmit = title.trim().length > 0 && !submitting && (
        quantities.length === 0 ||
        quantities.every((q) => q.unitId && q.value.trim() !== '' && !Number.isNaN(Number(q.value)))
    );

    // The harvest payload rides along only on a HARVEST entry that actually
    // names an output item + quantity. Everything else (lot code) is optional;
    // a HARVEST entry with no item set still submits with no harvest object.
    const harvestPayload = useMemo<HarvestPayload | null>(() => {
        if (type !== 'HARVEST') return null;
        const qty = Number(harvestQty);
        if (!harvestItemId || harvestQty.trim() === '' || Number.isNaN(qty) || qty <= 0) {
            return null;
        }
        return {
            itemId: harvestItemId,
            quantity: qty,
            lotCode: harvestLotCode.trim() || null,
        };
    }, [type, harvestItemId, harvestQty, harvestLotCode]);

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const body: JournalSubmitBody = {
                type,
                status,
                occurredAt: occurredAt ? occurredAt.toISOString() : null,
                title: title.trim(),
                notes: notes.trim() ? notes : null,
                quantities: quantities.map((q) => ({
                    measure: q.measure,
                    value: Number(q.value),
                    unitId: q.unitId,
                    label: q.label.trim() || null,
                })),
                locationIds,
            };
            if (harvestPayload) body.harvest = harvestPayload;
            let saved: { id: string };
            if (isEdit && initial?.id) {
                const res = await apiPatch<{ entry: { id: string } }>(
                    buildUrl(`/journal/${initial.id}`),
                    body,
                );
                saved = res.entry;
            } else {
                saved = await apiPost<{ id: string }>(buildUrl('/journal'), body);
            }
            setDirty(false);
            setOpen(false);
            onSaved?.(saved);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save entry');
        } finally {
            setSubmitting(false);
        }
    };

    // Unsaved-changes guard — same shape as NewAssetModal.
    const guardedSetOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
        (next) => {
            const wantClose = typeof next === 'function' ? !next(true) : next === false;
            if (wantClose) {
                if (submitting) return;
                if (dirty && !window.confirm('Discard entry? Any details you entered will be lost.')) {
                    return;
                }
            }
            setOpen(next);
        },
        [submitting, dirty, setOpen],
    );
    const close = () => guardedSetOpen(false);

    const heading = isEdit ? 'Edit journal entry' : 'New journal entry';
    const description = isEdit
        ? 'Update this field record.'
        : 'Record work done (or planned) on the farm.';

    return (
        <Modal
            showModal={open}
            setShowModal={guardedSetOpen}
            size="lg"
            title={heading}
            description={description}
            preventDefaultClose={submitting}
        >
            <Modal.Header title={heading} description={description} />
            <Modal.Form
                id="journal-entry-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                }}
            >
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="journal-entry-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    <fieldset disabled={submitting} className="m-0 p-0 border-0 space-y-default">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-default">
                            <FormField label="Type" required>
                                <Combobox
                                    options={TYPE_OPTIONS}
                                    selected={TYPE_OPTIONS.find((o) => o.value === type) ?? null}
                                    setSelected={(o) => {
                                        setType(o?.value ?? 'ACTIVITY');
                                        markDirty();
                                    }}
                                    placeholder="Select type"
                                    aria-label="Entry type"
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label="Status">
                                <Combobox
                                    options={STATUS_OPTIONS}
                                    selected={STATUS_OPTIONS.find((o) => o.value === status) ?? null}
                                    setSelected={(o) => {
                                        setStatus(o?.value ?? 'DONE');
                                        markDirty();
                                    }}
                                    placeholder="Select status"
                                    aria-label="Entry status"
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label="Date">
                                <DatePicker
                                    value={occurredAt}
                                    onChange={(d) => {
                                        setOccurredAt(d);
                                        markDirty();
                                    }}
                                    placeholder="Select date"
                                />
                            </FormField>
                        </div>

                        <FormField label="Title" required>
                            <Input
                                value={title}
                                onChange={(e) => {
                                    setTitle(e.target.value);
                                    markDirty();
                                }}
                                placeholder="e.g. Glyphosate pass on the south block"
                                id="journal-entry-title"
                            />
                        </FormField>

                        <FormField label="Notes">
                            <RichTextEditor
                                value={notes}
                                contentType="HTML"
                                onChange={(v) => {
                                    setNotes(v);
                                    markDirty();
                                }}
                                placeholder="Conditions, observations, operator notes…"
                                minHeightPx={160}
                            />
                        </FormField>

                        <FormField label="Locations">
                            <Combobox
                                multiple
                                options={locationOptions}
                                selected={locationOptions.filter((o) => locationIds.includes(o.value))}
                                setSelected={(opts) => {
                                    setLocationIds(opts.map((o) => o.value));
                                    markDirty();
                                }}
                                placeholder={locationOptions.length ? 'Link field blocks' : 'No locations yet'}
                                aria-label="Linked locations"
                                matchTriggerWidth
                            />
                        </FormField>

                        {/* Harvest output — HARVEST entries only. Optional: leave the
                            item blank and the entry submits with no lot minted. */}
                        {type === 'HARVEST' && (
                            <div
                                className="space-y-default rounded-lg border border-border-subtle bg-bg-default p-3"
                                id="journal-harvest-section"
                            >
                                <div>
                                    <span className="text-sm font-medium text-content-emphasis">Harvest output</span>
                                    <p className="mt-1 text-xs text-content-muted">
                                        Optional — name the harvested product and amount to mint a stock lot and record its lineage.
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                                    <FormField label="Harvested item">
                                        <Combobox
                                            options={harvestItemOptions}
                                            selected={harvestItemOptions.find((o) => o.value === harvestItemId) ?? null}
                                            setSelected={(o) => {
                                                setHarvestItemId(o?.value ?? '');
                                                markDirty();
                                            }}
                                            placeholder={harvestItemOptions.length ? 'Select product' : 'No products yet'}
                                            aria-label="Harvested item"
                                            matchTriggerWidth
                                        />
                                    </FormField>
                                    <FormField label="Quantity">
                                        <Input
                                            inputMode="decimal"
                                            value={harvestQty}
                                            onChange={(e) => {
                                                setHarvestQty(e.target.value.replace(/[^0-9.]/g, ''));
                                                markDirty();
                                            }}
                                            placeholder="Amount harvested"
                                            aria-label="Harvest quantity"
                                            id="journal-harvest-qty"
                                        />
                                    </FormField>
                                </div>
                                <FormField label="Lot code" hint="Optional — auto-generated if blank.">
                                    <Input
                                        value={harvestLotCode}
                                        onChange={(e) => {
                                            setHarvestLotCode(e.target.value);
                                            markDirty();
                                        }}
                                        placeholder="e.g. HARVEST-2026-06"
                                        aria-label="Harvest lot code"
                                    />
                                </FormField>
                            </div>
                        )}

                        {/* Quantities — farmOS measure + value + unit + label lines. */}
                        <div className="space-y-default">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-content-emphasis">Quantities</span>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    icon={<Plus className="size-3.5" />}
                                    onClick={addQuantity}
                                    id="journal-add-quantity"
                                >
                                    Quantity
                                </Button>
                            </div>
                            {quantities.length === 0 ? (
                                <p className="text-xs text-content-muted">
                                    Add the applied amount (an input application), the harvest weight, etc.
                                </p>
                            ) : (
                                <div className="space-y-tight">
                                    {quantities.map((q, i) => (
                                        <div
                                            key={i}
                                            className="grid grid-cols-12 gap-tight items-end"
                                            data-testid={`journal-quantity-row-${i}`}
                                        >
                                            <div className="col-span-3">
                                                <Combobox
                                                    options={QUANTITY_MEASURES.map((m) => ({ value: m, label: m }))}
                                                    selected={{ value: q.measure, label: q.measure }}
                                                    setSelected={(o) =>
                                                        updateQuantity(i, { measure: (o?.value as QuantityMeasure) ?? 'COUNT' })
                                                    }
                                                    aria-label="Measure"
                                                    matchTriggerWidth
                                                />
                                            </div>
                                            <div className="col-span-3">
                                                <Input
                                                    inputMode="decimal"
                                                    value={q.value}
                                                    onChange={(e) =>
                                                        updateQuantity(i, {
                                                            // Keep only number-ish characters so the
                                                            // decimal text input stays parseable.
                                                            value: e.target.value.replace(/[^0-9.\-]/g, ''),
                                                        })
                                                    }
                                                    placeholder="Amount"
                                                    aria-label="Value"
                                                />
                                            </div>
                                            <div className="col-span-3">
                                                <Combobox
                                                    options={unitOptions}
                                                    selected={unitOptions.find((o) => o.value === q.unitId) ?? null}
                                                    setSelected={(o) => updateQuantity(i, { unitId: o?.value ?? '' })}
                                                    placeholder="Unit"
                                                    aria-label="Unit"
                                                    matchTriggerWidth
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <Input
                                                    value={q.label}
                                                    onChange={(e) => updateQuantity(i, { label: e.target.value })}
                                                    placeholder="Label"
                                                    aria-label="Label"
                                                />
                                            </div>
                                            <div className="col-span-1 flex justify-end">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => removeQuantity(i)}
                                                    aria-label="Remove quantity"
                                                >
                                                    <Trash className="size-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={close}
                        disabled={submitting}
                        id="journal-entry-cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!canSubmit}
                        loading={submitting}
                        id="journal-entry-submit"
                    >
                        {isEdit ? 'Save entry' : 'Create entry'}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
