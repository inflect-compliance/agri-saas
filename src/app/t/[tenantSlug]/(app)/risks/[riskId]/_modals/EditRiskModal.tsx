/**
 * Edit Risk modal — mirrors the control detail page's
 * `_modals/EditControlModal.tsx` pattern (Elevation PR-2):
 *
 *   - State + mutation stay in the page (`page.tsx`).
 *   - This sub-component is a thin presentational renderer that
 *     takes everything via props.
 *   - Lives under `_modals/` so Next.js doesn't treat it as a route.
 *
 * Replaces the previous inline edit-mode block that swapped the
 * Overview read card for a form in place. The Edit affordance now
 * opens this modal, matching the control detail surface.
 *
 * Native text fields route through `<FormField>` (the canonical
 * label + control + error primitive). The custom controls
 * (Combobox / UserCombobox / NumberStepper / DatePicker) carry their
 * own aria affordances, so they use a plain visible label above the
 * control rather than an htmlFor pairing.
 */
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { UserCombobox } from '@/components/ui/user-combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { RiskEvaluationFields } from '../../_shared/RiskEvaluationFields';

export interface EditRiskForm {
    title?: string;
    description?: string | null;
    category?: string | null;
    treatmentOwner?: string | null;
    ownerUserId?: string | null;
    likelihood?: number;
    impact?: number;
    treatment?: string | null;
    treatmentNotes?: string | null;
    nextReviewAt?: string | null;
}

export interface EditRiskModalProps {
    open: boolean;
    setOpen: (next: boolean) => void;
    form: EditRiskForm;
    setForm: React.Dispatch<React.SetStateAction<EditRiskForm>>;
    saving: boolean;
    error: string | null;
    tenantSlug: string;
    categoryOptions: ComboboxOption[];
    treatmentOptions: ComboboxOption[];
    onCancel: () => void;
    onSubmit: (e: React.FormEvent) => void | Promise<void>;
}

const fieldLabel = 'mb-1 block text-sm text-content-default';

export function EditRiskModal({
    open,
    setOpen,
    form,
    setForm,
    saving,
    error,
    tenantSlug,
    categoryOptions,
    treatmentOptions,
    onCancel,
    onSubmit,
}: EditRiskModalProps) {
    const t = useTranslations('riskEdit');
    const titleValid = (form.title ?? '').trim().length >= 3;
    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next && !saving) onCancel();
                else setOpen(next);
            }}
            size="lg"
            title={t('title')}
            description={t('description')}
            preventDefaultClose={saving}
        >
            <Modal.Header
                title={t('title')}
                description={t('description')}
            />
            <Modal.Form onSubmit={onSubmit} id="risk-edit-dialog">
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    <fieldset className="space-y-default" disabled={saving}>
                        <FormField label={t('titleLabel')} required>
                            <input
                                id="risk-edit-title"
                                type="text"
                                className="input w-full"
                                value={form.title ?? ''}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, title: e.target.value }))
                                }
                                required
                                minLength={3}
                            />
                        </FormField>
                        <FormField label={t('descriptionLabel')}>
                            <textarea
                                id="risk-edit-description"
                                className="input min-h-[100px] w-full"
                                value={form.description ?? ''}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        description: e.target.value,
                                    }))
                                }
                            />
                        </FormField>
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <div>
                                <span className={fieldLabel}>{t('category')}</span>
                                <Combobox
                                    hideSearch
                                    selected={
                                        categoryOptions.find(
                                            (o) => o.value === (form.category ?? ''),
                                        ) ?? null
                                    }
                                    setSelected={(opt) =>
                                        setForm((f) => ({
                                            ...f,
                                            category: opt?.value ?? '',
                                        }))
                                    }
                                    options={categoryOptions}
                                    placeholder={t('selectPlaceholder')}
                                    matchTriggerWidth
                                    buttonProps={{ className: 'w-full' }}
                                    caret
                                />
                            </div>
                            <FormField label={t('treatmentOwner')}>
                                <input
                                    id="risk-edit-treatment-owner"
                                    className="input w-full"
                                    value={form.treatmentOwner ?? ''}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            treatmentOwner: e.target.value,
                                        }))
                                    }
                                />
                            </FormField>
                            <div>
                                <span className={fieldLabel}>{t('owner')}</span>
                                <UserCombobox
                                    tenantSlug={tenantSlug}
                                    selectedId={form.ownerUserId || null}
                                    onChange={(userId) =>
                                        setForm((f) => ({
                                            ...f,
                                            ownerUserId: userId ?? '',
                                        }))
                                    }
                                    matchTriggerWidth
                                    id="risk-edit-assignee"
                                    placeholder={t('ownerPlaceholder')}
                                />
                            </div>
                        </div>
                        <RiskEvaluationFields
                            idPrefix="risk-edit"
                            likelihood={form.likelihood ?? 3}
                            impact={form.impact ?? 3}
                            onLikelihood={(v) =>
                                setForm((f) => ({ ...f, likelihood: v }))
                            }
                            onImpact={(v) =>
                                setForm((f) => ({ ...f, impact: v }))
                            }
                        />
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <div>
                                <span className={fieldLabel}>{t('treatment')}</span>
                                <Combobox
                                    hideSearch
                                    selected={
                                        treatmentOptions.find(
                                            (o) => o.value === (form.treatment ?? ''),
                                        ) ?? null
                                    }
                                    setSelected={(opt) =>
                                        setForm((f) => ({
                                            ...f,
                                            treatment: opt?.value ?? '',
                                        }))
                                    }
                                    options={treatmentOptions}
                                    placeholder={t('treatmentPlaceholder')}
                                    matchTriggerWidth
                                    buttonProps={{ className: 'w-full' }}
                                    caret
                                />
                            </div>
                            <div>
                                <span className={fieldLabel}>{t('nextReview')}</span>
                                <DatePicker
                                    id="risk-edit-next-review"
                                    className="w-full"
                                    placeholder={t('pickDate')}
                                    clearable
                                    align="start"
                                    value={parseYMD(form.nextReviewAt ?? '')}
                                    onChange={(next) =>
                                        setForm((f) => ({
                                            ...f,
                                            nextReviewAt: toYMD(next) ?? '',
                                        }))
                                    }
                                    disabledDays={{ before: startOfUtcDay(new Date()) }}
                                    aria-label={t('nextReviewDate')}
                                />
                            </div>
                        </div>
                        <FormField label={t('treatmentNotes')}>
                            <textarea
                                id="risk-edit-treatment-notes"
                                className="input min-h-[80px] w-full"
                                value={form.treatmentNotes ?? ''}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        treatmentNotes: e.target.value,
                                    }))
                                }
                            />
                        </FormField>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onCancel}
                        disabled={saving}
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={saving || !titleValid}
                        id="save-risk-btn"
                    >
                        {saving ? t('saving') : t('save')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
