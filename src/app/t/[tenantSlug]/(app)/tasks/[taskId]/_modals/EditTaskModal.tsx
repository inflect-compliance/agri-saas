/**
 * Edit Task modal — task-detail Overview edit affordance.
 *
 * Mirrors the control detail `EditControlModal` pattern: the page owns
 * the mutation + state, this component is a thin presentational
 * renderer. Lives under `_modals/` so Next.js doesn't treat it as a
 * route. Status and assignee have their own dedicated controls on the
 * detail page, so they are intentionally NOT edited here — this modal
 * covers the descriptive metadata (title, description, type, severity,
 * priority, due date).
 */
'use client';

import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD } from '@/components/ui/date-picker/date-utils';
import { useTranslations } from 'next-intl';

export interface EditTaskForm {
    title: string;
    description: string;
    type: string;
    severity: string;
    priority: string;
    /** YYYY-MM-DD (empty string = no due date). */
    dueAt: string;
}

const TYPE_OPTIONS: ComboboxOption[] = [
    { value: 'TASK', label: 'Task' },
    { value: 'AUDIT_FINDING', label: 'Audit Finding' },
    { value: 'CONTROL_GAP', label: 'Control Gap' },
    { value: 'INCIDENT', label: 'Incident' },
    { value: 'IMPROVEMENT', label: 'Improvement' },
];

const SEVERITY_OPTIONS: ComboboxOption[] = [
    { value: 'INFO', label: 'Info' },
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' },
    { value: 'CRITICAL', label: 'Critical' },
];

const PRIORITY_OPTIONS: ComboboxOption[] = [
    { value: 'P0', label: 'P0 — Critical' },
    { value: 'P1', label: 'P1 — High' },
    { value: 'P2', label: 'P2 — Medium' },
    { value: 'P3', label: 'P3 — Low' },
];

export interface EditTaskModalProps {
    open: boolean;
    setOpen: (next: boolean) => void;
    form: EditTaskForm;
    setForm: React.Dispatch<React.SetStateAction<EditTaskForm>>;
    saving: boolean;
    error: string;
    onCancel: () => void;
    onSubmit: (e: React.FormEvent) => void | Promise<void>;
}

export function EditTaskModal({
    open,
    setOpen,
    form,
    setForm,
    saving,
    error,
    onCancel,
    onSubmit,
}: EditTaskModalProps) {
    const t = useTranslations('tasks.editModal');
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
            <Modal.Header title={t('title')} description={t('description')} />
            <Modal.Form onSubmit={onSubmit} id="task-edit-dialog" data-testid="task-edit-dialog">
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            role="alert"
                            data-testid="task-edit-error"
                        >
                            {error}
                        </div>
                    )}
                    <fieldset className="space-y-default" disabled={saving}>
                        <FormField label={t('fieldTitle')} required>
                            <input
                                id="task-edit-title"
                                type="text"
                                className="input w-full"
                                value={form.title}
                                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                                required
                                minLength={1}
                                data-testid="task-edit-title-input"
                            />
                        </FormField>
                        <FormField label={t('fieldDescription')}>
                            <textarea
                                id="task-edit-description"
                                className="input w-full"
                                rows={3}
                                value={form.description}
                                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                data-testid="task-edit-description-input"
                            />
                        </FormField>
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={t('fieldType')}>
                                <Combobox
                                    hideSearch
                                    id="task-edit-type"
                                    selected={TYPE_OPTIONS.find((o) => o.value === form.type) ?? null}
                                    setSelected={(opt) => setForm((f) => ({ ...f, type: opt?.value ?? f.type }))}
                                    options={TYPE_OPTIONS}
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label={t('fieldDueDate')}>
                                <DatePicker
                                    id="task-edit-due"
                                    className="w-full"
                                    placeholder={t('datePlaceholder')}
                                    clearable
                                    align="start"
                                    value={parseYMD(form.dueAt)}
                                    onChange={(next) =>
                                        setForm((f) => ({
                                            ...f,
                                            dueAt: next
                                                ? `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
                                                : '',
                                        }))
                                    }
                                    aria-label={t('dueDateAria')}
                                />
                            </FormField>
                        </div>
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={t('fieldSeverity')}>
                                <Combobox
                                    hideSearch
                                    id="task-edit-severity"
                                    selected={SEVERITY_OPTIONS.find((o) => o.value === form.severity) ?? null}
                                    setSelected={(opt) => setForm((f) => ({ ...f, severity: opt?.value ?? f.severity }))}
                                    options={SEVERITY_OPTIONS}
                                    matchTriggerWidth
                                />
                            </FormField>
                            <FormField label={t('fieldPriority')}>
                                <Combobox
                                    hideSearch
                                    id="task-edit-priority"
                                    selected={PRIORITY_OPTIONS.find((o) => o.value === form.priority) ?? null}
                                    setSelected={(opt) => setForm((f) => ({ ...f, priority: opt?.value ?? f.priority }))}
                                    options={PRIORITY_OPTIONS}
                                    matchTriggerWidth
                                />
                            </FormField>
                        </div>
                    </fieldset>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onCancel}
                        disabled={saving}
                        data-testid="task-edit-cancel-button"
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={saving || form.title.trim().length < 1}
                        data-testid="task-edit-save-button"
                    >
                        {saving ? t('saving') : t('save')}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
