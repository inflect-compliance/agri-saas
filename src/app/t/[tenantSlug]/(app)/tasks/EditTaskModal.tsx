'use client';

/**
 * EditTaskModal — Phase 2 of the tasks-tab parity work.
 *
 * The companion to `<NewTaskModal>`: an inline edit surface opened
 * by the row-level "edit" affordance on BOTH the Tasks list table
 * (`TasksClient`) and the per-control / asset / risk Tasks tab
 * (`LinkedTasksPanel`). Mirrors the controls-table quick-edit
 * pattern — click the pencil, the entity opens in a modal.
 *
 * Field surface intentionally tracks what the task PATCH endpoint
 * accepts (`UpdateTaskSchema`): title, description, severity,
 * priority, dueAt. `type` is immutable post-create so it renders
 * read-only. Assignee has its own focused endpoint
 * (`/tasks/{id}/assign`) so we PATCH the descriptive fields and,
 * only when the assignee actually changed, fire one extra POST.
 *
 * Seeds from a fresh GET on open (not the list row) so description /
 * priority — fields the list projection omits — are always current.
 */
import {
    useCallback,
    useEffect,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { useTenantApiUrl, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { UserCombobox } from '@/components/ui/user-combobox';

// Severity here carries INFO (the PATCH schema accepts it and
// existing tasks may already be INFO) — the create form omits it.
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
const TYPE_LABELS: Record<string, string> = {
    TASK: 'Task',
    AUDIT_FINDING: 'Audit Finding',
    CONTROL_GAP: 'Control Gap',
    INCIDENT: 'Incident',
    IMPROVEMENT: 'Improvement',
};

export interface EditTaskModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    /** Task to edit. Null renders the modal closed/idle. */
    taskId: string | null;
    /** Refresh callback fired after a successful save. */
    onSaved?: () => void;
}

interface EditableTask {
    title: string;
    description: string;
    type: string;
    severity: string;
    priority: string;
    dueAt: string; // YYYY-MM-DD or ''
    assigneeUserId: string;
}

const EMPTY: EditableTask = {
    title: '',
    description: '',
    type: 'TASK',
    severity: 'MEDIUM',
    priority: 'P2',
    dueAt: '',
    assigneeUserId: '',
};

export function EditTaskModal({
    open,
    setOpen,
    taskId,
    onSaved,
}: EditTaskModalProps) {
    const apiUrl = useTenantApiUrl();
    const { tenantSlug } = useTenantContext();

    const [fields, setFields] = useState<EditableTask>(EMPTY);
    const [originalAssignee, setOriginalAssignee] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);

    const setField = useCallback(
        <K extends keyof EditableTask>(key: K, value: EditableTask[K]) => {
            setFields((prev) => ({ ...prev, [key]: value }));
            setDirty(true);
        },
        [],
    );

    // Seed from a fresh GET each time the modal opens for a task.
    useEffect(() => {
        if (!open || !taskId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setDirty(false);
        (async () => {
            try {
                const res = await fetch(apiUrl(`/tasks/${taskId}`));
                if (!res.ok) throw new Error('Failed to load task');
                const t = await res.json();
                if (cancelled) return;
                const seeded: EditableTask = {
                    title: t.title ?? '',
                    description: t.description ?? '',
                    type: t.type ?? 'TASK',
                    severity: t.severity ?? 'MEDIUM',
                    priority: t.priority ?? 'P2',
                    // API returns an ISO timestamp; the DatePicker reads YMD.
                    dueAt: t.dueAt ? String(t.dueAt).slice(0, 10) : '',
                    assigneeUserId: t.assigneeUserId ?? '',
                };
                setFields(seeded);
                setOriginalAssignee(seeded.assigneeUserId);
            } catch (e) {
                if (!cancelled)
                    setError(
                        e instanceof Error ? e.message : 'Failed to load task',
                    );
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, taskId]);

    const guardedSetOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
        (next) => {
            const wantClose =
                typeof next === 'function' ? !next(true) : next === false;
            if (wantClose) {
                if (saving) return;
                if (
                    dirty &&
                    !window.confirm(
                        'Discard changes? Any edits you made will be lost.',
                    )
                ) {
                    return;
                }
            }
            setOpen(next);
        },
        [saving, dirty, setOpen],
    );
    const close = () => guardedSetOpen(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!taskId || saving) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/tasks/${taskId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: fields.title,
                    description: fields.description || null,
                    severity: fields.severity,
                    priority: fields.priority,
                    dueAt: fields.dueAt || null,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(
                    (typeof data.error === 'string' && data.error) ||
                        data.message ||
                        'Failed to save task',
                );
            }
            // Assignee lives behind its own endpoint — only touch it when
            // it actually changed so a no-op edit doesn't re-assign.
            if (fields.assigneeUserId !== originalAssignee) {
                await fetch(apiUrl(`/tasks/${taskId}/assign`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        assigneeUserId: fields.assigneeUserId || null,
                    }),
                }).catch(() => {
                    /* descriptive fields already saved; assignment is best-effort */
                });
            }
            setOpen(false);
            onSaved?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save task');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            showModal={open}
            setShowModal={guardedSetOpen}
            size="lg"
            title="Edit task"
            description="Update this task's details."
            preventDefaultClose={saving}
        >
            <Modal.Header
                title="Edit task"
                description="Update this task's details."
            />
            <Modal.Form id="edit-task-form" onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="edit-task-error"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    {loading ? (
                        <div className="text-content-subtle text-sm animate-pulse py-8 text-center">
                            Loading task…
                        </div>
                    ) : (
                        <fieldset
                            disabled={saving}
                            className="m-0 p-0 border-0 space-y-default"
                        >
                            <FormField label="Title" required>
                                <Input
                                    id="edit-task-title-input"
                                    type="text"
                                    placeholder="Brief summary of the task"
                                    value={fields.title}
                                    onChange={(e) =>
                                        setField('title', e.target.value)
                                    }
                                    required
                                />
                            </FormField>
                            <FormField label="Description">
                                <Textarea
                                    id="edit-task-description-input"
                                    rows={3}
                                    placeholder="Detailed description (optional)"
                                    value={fields.description}
                                    onChange={(e) =>
                                        setField('description', e.target.value)
                                    }
                                />
                            </FormField>
                            <div className="grid grid-cols-3 gap-default">
                                <FormField label="Type">
                                    {/* Type is immutable post-create. */}
                                    <div className="flex h-9 items-center">
                                        <StatusBadge variant="neutral">
                                            {TYPE_LABELS[fields.type] ||
                                                fields.type}
                                        </StatusBadge>
                                    </div>
                                </FormField>
                                <FormField label="Severity">
                                    <Combobox
                                        id="edit-task-severity-select"
                                        name="severity"
                                        options={SEVERITY_OPTIONS}
                                        selected={
                                            SEVERITY_OPTIONS.find(
                                                (o) =>
                                                    o.value === fields.severity,
                                            ) ?? null
                                        }
                                        setSelected={(o) =>
                                            setField(
                                                'severity',
                                                o?.value ?? 'MEDIUM',
                                            )
                                        }
                                        placeholder="Select severity…"
                                        hideSearch
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                </FormField>
                                <FormField label="Priority">
                                    <Combobox
                                        id="edit-task-priority-select"
                                        name="priority"
                                        options={PRIORITY_OPTIONS}
                                        selected={
                                            PRIORITY_OPTIONS.find(
                                                (o) =>
                                                    o.value === fields.priority,
                                            ) ?? null
                                        }
                                        setSelected={(o) =>
                                            setField('priority', o?.value ?? 'P2')
                                        }
                                        placeholder="Select priority…"
                                        hideSearch
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                </FormField>
                            </div>
                            <div className="grid grid-cols-2 gap-default">
                                <FormField label="Due Date">
                                    <DatePicker
                                        id="edit-task-due-input"
                                        className="w-full"
                                        placeholder="Select date"
                                        clearable
                                        align="start"
                                        value={parseYMD(fields.dueAt)}
                                        onChange={(next) =>
                                            setField('dueAt', toYMD(next) ?? '')
                                        }
                                        disabledDays={{
                                            before: startOfUtcDay(new Date()),
                                        }}
                                        aria-label="Due date"
                                    />
                                </FormField>
                                <FormField label="Assignee">
                                    <UserCombobox
                                        id="edit-task-assignee-input"
                                        name="assigneeUserId"
                                        tenantSlug={tenantSlug}
                                        selectedId={
                                            fields.assigneeUserId || null
                                        }
                                        onChange={(userId) =>
                                            setField(
                                                'assigneeUserId',
                                                userId ?? '',
                                            )
                                        }
                                        placeholder="Unassigned"
                                        forceDropdown={false}
                                    />
                                </FormField>
                            </div>
                        </fieldset>
                    )}
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={close}
                        disabled={saving}
                        id="edit-task-cancel-btn"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={saving || loading || !fields.title.trim()}
                        id="save-task-btn"
                    >
                        {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
