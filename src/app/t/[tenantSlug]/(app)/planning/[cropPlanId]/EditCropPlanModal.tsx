'use client';

/**
 * EditCropPlanModal — edit an existing crop plan's succession config.
 *
 * Pairs with NewCropPlanModal but for the UPDATE path: it PATCHes the
 * plan's editable fields (season + crop type are structural and fixed at
 * creation, so they aren't editable here). Reuses the same form
 * primitives; the variety list is fetched + narrowed to the plan's crop
 * type. Only the fields the user actually changed are sent.
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { apiPatch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';

interface VarietyOption {
    id: string;
    name: string;
    cropType?: { id: string; name: string } | null;
}

export interface EditablePlan {
    id: string;
    name: string;
    method: string;
    firstSowDate: string;
    successions: number;
    intervalDays: number;
    plantsPerSuccession: number | null;
    notes: string | null;
    cropType?: { id: string; name: string } | null;
    variety?: { id: string; name: string } | null;
}

export function EditCropPlanModal({
    open,
    setOpen,
    plan,
    onSaved,
}: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    plan: EditablePlan;
    onSaved?: () => void;
}) {
    const t = useTranslations('planning.newPlan');
    const te = useTranslations('planning.editPlan');
    const buildUrl = useTenantApiUrl();

    const METHOD_OPTIONS: ComboboxOption[] = useMemo(
        () => [
            { value: 'DIRECT_SOW', label: t('methodDirectSow') },
            { value: 'TRANSPLANT', label: t('methodTransplant') },
        ],
        [t],
    );

    // Varieties for the plan's crop type — fetched lazily while open.
    const varietiesSWR = useTenantSWR<VarietyOption[]>(open ? '/planning/crop-varieties' : null);
    const varietyOptions: ComboboxOption[] = useMemo(() => {
        const all = varietiesSWR.data ?? [];
        const scoped = plan.cropType?.id ? all.filter((v) => v.cropType?.id === plan.cropType?.id) : all;
        return scoped.map((v) => ({ value: v.id, label: v.name }));
    }, [varietiesSWR.data, plan.cropType?.id]);

    const [name, setName] = useState(plan.name);
    const [cropVarietyId, setCropVarietyId] = useState(plan.variety?.id ?? '');
    const [method, setMethod] = useState(plan.method);
    const [firstSowDate, setFirstSowDate] = useState<Date | null>(new Date(plan.firstSowDate));
    const [successions, setSuccessions] = useState(String(plan.successions));
    const [intervalDays, setIntervalDays] = useState(String(plan.intervalDays));
    const [plantsPerSuccession, setPlantsPerSuccession] = useState(
        plan.plantsPerSuccession != null ? String(plan.plantsPerSuccession) : '',
    );
    const [notes, setNotes] = useState(plan.notes ?? '');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-seed the form from the plan every time the modal opens (so a
    // reopen reflects the latest saved state, not stale edits).
    /* eslint-disable react-hooks/set-state-in-effect -- intentional form re-seed on open. */
    useEffect(() => {
        if (!open) return;
        setName(plan.name);
        setCropVarietyId(plan.variety?.id ?? '');
        setMethod(plan.method);
        setFirstSowDate(new Date(plan.firstSowDate));
        setSuccessions(String(plan.successions));
        setIntervalDays(String(plan.intervalDays));
        setPlantsPerSuccession(plan.plantsPerSuccession != null ? String(plan.plantsPerSuccession) : '');
        setNotes(plan.notes ?? '');
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, plan.id]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const canSubmit = name.trim().length > 0 && firstSowDate && !submitting;

    const submit = async () => {
        if (!canSubmit || !firstSowDate) return;
        setSubmitting(true);
        setError(null);
        try {
            await apiPatch(buildUrl(`/planning/crop-plans/${plan.id}`), {
                name: name.trim(),
                cropVarietyId: cropVarietyId || null,
                method,
                firstSowDate: firstSowDate.toISOString(),
                successions: Number(successions) || 1,
                intervalDays: Number(intervalDays) || 0,
                plantsPerSuccession: plantsPerSuccession.trim() === '' ? null : Number(plantsPerSuccession),
                notes: notes.trim() === '' ? null : notes.trim(),
            });
            setOpen(false);
            onSaved?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : te('saveFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const heading = te('heading');
    const description = te('description');

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
                id="edit-crop-plan-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                }}
            >
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="edit-crop-plan-error"
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
                                id="edit-crop-plan-name"
                            />
                        </FormField>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                            <FormField label={t('variety')} hint={t('varietyHint')}>
                                <Combobox
                                    options={varietyOptions}
                                    selected={varietyOptions.find((o) => o.value === cropVarietyId) ?? null}
                                    setSelected={(o) => setCropVarietyId(o?.value ?? '')}
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
                                    id="edit-crop-plan-successions"
                                />
                            </FormField>
                            <FormField label={t('intervalDays')} hint={t('intervalHint')}>
                                <Input
                                    inputMode="numeric"
                                    value={intervalDays}
                                    onChange={(e) => setIntervalDays(e.target.value.replace(/[^0-9]/g, ''))}
                                    placeholder="0"
                                    id="edit-crop-plan-interval"
                                />
                            </FormField>
                        </div>

                        <FormField label={t('plantsPerSuccession')} hint={t('plantsHint')}>
                            <Input
                                inputMode="numeric"
                                value={plantsPerSuccession}
                                onChange={(e) => setPlantsPerSuccession(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder={t('plantsPlaceholder')}
                                id="edit-crop-plan-plants"
                            />
                        </FormField>

                        <FormField label={te('notes')}>
                            <Input
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={te('notesPlaceholder')}
                                id="edit-crop-plan-notes"
                            />
                        </FormField>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => setOpen(false)}
                        disabled={submitting}
                        id="edit-crop-plan-cancel"
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!canSubmit}
                        loading={submitting}
                        id="edit-crop-plan-submit"
                    >
                        {te('save')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
