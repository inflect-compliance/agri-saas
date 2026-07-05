'use client';
/* TODO(swr-migration): fetch-on-open + setState pattern flagged by
 * react-hooks/set-state-in-effect. The inline disable directives below
 * mirror the sibling LinkedTasksPanel / ControlDetailSheet contract. */
/* eslint-disable react-hooks/exhaustive-deps -- the seed effect keys on
 * the loaded task id; adding every field would re-seed mid-edit. */

/**
 * Task quick-inspect / edit Sheet — the task analogue of
 * `<ControlDetailSheet>`. Opened by clicking a task row (the Tasks
 * tab on a control / asset / risk, and the row-edit affordance on the
 * global Tasks list). The list/tab stays visible behind the Sheet so
 * scroll + filter context survive the edit.
 *
 * Field surface mirrors the task PATCH endpoint (`UpdateTaskSchema`):
 * title, description, severity, priority, dueAt. `type` is immutable
 * post-create so it shows in the read-only summary. Assignee has its
 * own focused endpoint (`/tasks/{id}/assign`) — only fired when it
 * actually changed. Seeds from a fresh GET on open so description /
 * priority (omitted from list projections) are current.
 *
 * Uses plain fetch + local state (NOT react-query / SWR) so it drops
 * into both the SWR-backed Tasks page and the fetch-backed
 * LinkedTasksPanel unchanged; callers pass `onSaved` to refresh their
 * own data source.
 */
import Link from 'next/link';
import {
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { Sheet } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { RequiredMarker } from '@/components/ui/required-marker';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { UserCombobox } from '@/components/ui/user-combobox';
import { useTranslations } from 'next-intl';

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
const TYPE_OPTIONS: ComboboxOption[] = Object.entries(TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
);
const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'neutral',
    TRIAGED: 'info',
    IN_PROGRESS: 'info',
    BLOCKED: 'error',
    RESOLVED: 'success',
    CLOSED: 'neutral',
    CANCELED: 'neutral',
};
const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open',
    TRIAGED: 'Triaged',
    IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
    CANCELED: 'Canceled',
};

interface TaskDetail {
    id: string;
    key: string | null;
    title: string;
    description: string | null;
    type: string;
    severity: string;
    priority: string;
    status: string;
    dueAt: string | null;
    assigneeUserId: string | null;
    assignee: { id: string; name: string | null; email: string | null } | null;
}

interface EditForm {
    title: string;
    description: string;
    type: string;
    severity: string;
    priority: string;
    dueAt: string;
    assigneeUserId: string;
}

export interface TaskDetailSheetProps {
    /** Open when non-null; the value is the task id being inspected. */
    taskId: string | null;
    setTaskId: Dispatch<SetStateAction<string | null>>;
    tenantSlug: string;
    /** Helper to build tenant-scoped API URLs. */
    apiUrl: (path: string) => string;
    /** Helper to build tenant-scoped app URLs (for "Open full detail"). */
    tenantHref: (path: string) => string;
    /** Gate the edit controls behind the caller's write permission. */
    canWrite: boolean;
    /** Fired after a successful save so the caller refreshes its data. */
    onSaved?: () => void;
}

export function TaskDetailSheet({
    taskId,
    setTaskId,
    tenantSlug,
    apiUrl,
    tenantHref,
    canWrite,
    onSaved,
}: TaskDetailSheetProps) {
    const open = taskId !== null;
    const t = useTranslations('tasks.sheet');
    const titleRef = useRef<HTMLInputElement>(null);

    const [task, setTask] = useState<TaskDetail | null>(null);
    const [form, setForm] = useState<EditForm>({
        title: '',
        description: '',
        type: 'TASK',
        severity: 'MEDIUM',
        priority: 'P2',
        dueAt: '',
        assigneeUserId: '',
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState('');

    // Seed from a fresh GET each time the Sheet opens for a task.
    useEffect(() => {
        if (!open || !taskId) return;
        let cancelled = false;
        setLoading(true);
        setError('');
        setDirty(false);
        setTask(null);
        (async () => {
            try {
                const res = await fetch(apiUrl(`/tasks/${taskId}`));
                if (!res.ok) throw new Error('Failed to load task');
                const t: TaskDetail = await res.json();
                if (cancelled) return;
                setTask(t);
                setForm({
                    title: t.title ?? '',
                    description: t.description ?? '',
                    type: t.type ?? 'TASK',
                    severity: t.severity ?? 'MEDIUM',
                    priority: t.priority ?? 'P2',
                    dueAt: t.dueAt ? String(t.dueAt).slice(0, 10) : '',
                    assigneeUserId: t.assigneeUserId ?? '',
                });
            } catch (e) {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : 'Failed to load task');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, taskId]);

    useEffect(() => {
        if (!open || !task) return;
        const t = setTimeout(() => titleRef.current?.focus(), 80);
        return () => clearTimeout(t);
    }, [open, task?.id]);

    const update = <K extends keyof EditForm>(field: K, value: EditForm[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        setDirty(true);
    };

    const canSave =
        canWrite && dirty && form.title.trim().length >= 1 && !saving;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSave || !taskId) return;
        setSaving(true);
        setError('');
        try {
            const res = await fetch(apiUrl(`/tasks/${taskId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: form.title.trim(),
                    description: form.description.trim() || null,
                    type: form.type,
                    severity: form.severity,
                    priority: form.priority,
                    dueAt: form.dueAt || null,
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
            // Assignee lives behind its own endpoint — only touch it
            // when it actually changed so a no-op edit doesn't reassign.
            if (form.assigneeUserId !== (task?.assigneeUserId ?? '')) {
                await fetch(apiUrl(`/tasks/${taskId}/assign`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        assigneeUserId: form.assigneeUserId || null,
                    }),
                }).catch(() => {
                    /* descriptive fields saved; assignment best-effort */
                });
            }
            setTaskId(null);
            onSaved?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save task');
        } finally {
            setSaving(false);
        }
    };

    const performDelete = async () => {
        if (!taskId) return;
        setDeleting(true);
        setError('');
        try {
            const res = await fetch(apiUrl(`/tasks/${taskId}`), {
                method: 'DELETE',
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(
                    (typeof data.error === 'string' && data.error) ||
                        data.message ||
                        'Failed to delete task',
                );
            }
            setShowDeleteConfirm(false);
            setTaskId(null);
            onSaved?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete task');
        } finally {
            setDeleting(false);
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (next) return;
        if (dirty && !saving) {
            const ok =
                typeof window !== 'undefined'
                    ? window.confirm(t('discardConfirm'))
                    : true;
            if (!ok) return;
        }
        setTaskId(null);
    };

    return (
        <>
        <Sheet
            open={open}
            onOpenChange={handleOpenChange}
            size="md"
            title={task?.title ?? t('fallbackTitle')}
            description={task?.key ?? undefined}
        >
            {loading || !task ? (
                <>
                    <Sheet.Header title={error ? t('headerTask') : t('headerLoading')} />
                    <Sheet.Body>
                        {error ? (
                            <div
                                className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                                role="alert"
                                data-testid="task-sheet-error"
                            >
                                {error}
                            </div>
                        ) : (
                            <div className="flex h-40 items-center justify-center text-sm text-content-muted">
                                {t('loadingTask')}
                            </div>
                        )}
                    </Sheet.Body>
                </>
            ) : (
                <>
                    <Sheet.Header
                        title={task.title}
                        description={task.key ?? undefined}
                    />
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-1 flex-col overflow-hidden"
                        data-testid="task-sheet-form"
                    >
                        <Sheet.Body>
                            {/* Read-only summary */}
                            <section
                                className="mb-5 grid grid-cols-2 gap-compact rounded-lg border border-border-subtle bg-bg-subtle px-4 py-3"
                                data-testid="task-sheet-summary"
                            >
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs uppercase tracking-wide text-content-muted">
                                        {t('summaryType')}
                                    </span>
                                    <StatusBadge variant="neutral" className="w-fit">
                                        {TYPE_LABELS[task.type] || task.type}
                                    </StatusBadge>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs uppercase tracking-wide text-content-muted">
                                        {t('summaryStatus')}
                                    </span>
                                    <StatusBadge
                                        variant={STATUS_BADGE[task.status] || 'neutral'}
                                        className="w-fit"
                                    >
                                        {STATUS_LABELS[task.status] || task.status}
                                    </StatusBadge>
                                </div>
                            </section>

                            {error && (
                                <div
                                    className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                                    role="alert"
                                    data-testid="task-sheet-save-error"
                                >
                                    {error}
                                </div>
                            )}

                            <fieldset
                                className="space-y-default"
                                disabled={!canWrite || saving}
                            >
                                <div>
                                    <label
                                        className="mb-1 block text-sm text-content-default"
                                        htmlFor="task-sheet-title-input"
                                    >
                                        {t('fieldTitle')} <RequiredMarker />
                                    </label>
                                    <input
                                        id="task-sheet-title-input"
                                        ref={titleRef}
                                        type="text"
                                        className="input w-full"
                                        data-testid="task-sheet-title-input"
                                        value={form.title}
                                        onChange={(e) => update('title', e.target.value)}
                                        required
                                        minLength={1}
                                    />
                                </div>
                                <div>
                                    <label
                                        className="mb-1 block text-sm text-content-default"
                                        htmlFor="task-sheet-description-input"
                                    >
                                        {t('fieldDescription')}
                                    </label>
                                    <textarea
                                        id="task-sheet-description-input"
                                        className="input w-full"
                                        rows={3}
                                        value={form.description}
                                        onChange={(e) =>
                                            update('description', e.target.value)
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        className="mb-1 block text-sm text-content-default"
                                        htmlFor="task-sheet-type-input"
                                    >
                                        {t('fieldType')}
                                    </label>
                                    <Combobox
                                        id="task-sheet-type-input"
                                        name="type"
                                        options={TYPE_OPTIONS}
                                        selected={
                                            TYPE_OPTIONS.find(
                                                (o) => o.value === form.type,
                                            ) ?? null
                                        }
                                        setSelected={(o) =>
                                            update('type', o?.value ?? 'TASK')
                                        }
                                        placeholder={t('typePlaceholder')}
                                        disabled={!canWrite}
                                        hideSearch
                                        matchTriggerWidth
                                        forceDropdown
                                        buttonProps={{ className: 'w-full' }}
                                        caret
                                    />
                                </div>
                                <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                                    <div>
                                        <label
                                            className="mb-1 block text-sm text-content-default"
                                            htmlFor="task-sheet-severity-input"
                                        >
                                            {t('fieldSeverity')}
                                        </label>
                                        <Combobox
                                            id="task-sheet-severity-input"
                                            name="severity"
                                            options={SEVERITY_OPTIONS}
                                            selected={
                                                SEVERITY_OPTIONS.find(
                                                    (o) => o.value === form.severity,
                                                ) ?? null
                                            }
                                            setSelected={(o) =>
                                                update('severity', o?.value ?? 'MEDIUM')
                                            }
                                            placeholder="—"
                                            disabled={!canWrite}
                                            hideSearch
                                            matchTriggerWidth
                                            forceDropdown
                                            buttonProps={{ className: 'w-full' }}
                                            caret
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="mb-1 block text-sm text-content-default"
                                            htmlFor="task-sheet-priority-input"
                                        >
                                            {t('fieldPriority')}
                                        </label>
                                        <Combobox
                                            id="task-sheet-priority-input"
                                            name="priority"
                                            options={PRIORITY_OPTIONS}
                                            selected={
                                                PRIORITY_OPTIONS.find(
                                                    (o) => o.value === form.priority,
                                                ) ?? null
                                            }
                                            setSelected={(o) =>
                                                update('priority', o?.value ?? 'P2')
                                            }
                                            placeholder="—"
                                            disabled={!canWrite}
                                            hideSearch
                                            matchTriggerWidth
                                            forceDropdown
                                            buttonProps={{ className: 'w-full' }}
                                            caret
                                        />
                                    </div>
                                </div>
                                <FormField label={t('fieldDueDate')}>
                                    <DatePicker
                                        id="task-sheet-due-input"
                                        className="w-full"
                                        placeholder={t('datePlaceholder')}
                                        clearable
                                        align="start"
                                        value={parseYMD(form.dueAt)}
                                        onChange={(next) =>
                                            update('dueAt', toYMD(next) ?? '')
                                        }
                                        disabledDays={{ before: startOfUtcDay(new Date()) }}
                                        aria-label={t('dueDateAria')}
                                    />
                                </FormField>
                                <FormField
                                    label={t('fieldAssignee')}
                                    description={t('assigneeDescription')}
                                >
                                    <UserCombobox
                                        id="task-sheet-assignee-input"
                                        name="assigneeUserId"
                                        tenantSlug={tenantSlug}
                                        disabled={!canWrite}
                                        selectedId={form.assigneeUserId || null}
                                        onChange={(userId) =>
                                            update('assigneeUserId', userId ?? '')
                                        }
                                        placeholder={
                                            task.assignee?.name ||
                                            task.assignee?.email ||
                                            'Unassigned'
                                        }
                                    />
                                </FormField>
                            </fieldset>
                        </Sheet.Body>
                        <Sheet.Actions align="between">
                            <div className="flex flex-col items-start gap-tight">
                                {canWrite && (
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => setShowDeleteConfirm(true)}
                                        disabled={deleting || saving}
                                        data-testid="task-sheet-delete"
                                        text={deleting ? t('deleting') : t('deleteTask')}
                                    />
                                )}
                                <Link
                                    href={tenantHref(`/tasks/${task.id}`)}
                                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                                    data-testid="task-sheet-open-full"
                                    onClick={() => setTaskId(null)}
                                >
                                    {t('seeFullDetail')}
                                </Link>
                            </div>
                            <div className="flex items-center gap-tight">
                                <Sheet.Close asChild>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        data-testid="task-sheet-cancel"
                                        text={t('cancel')}
                                    />
                                </Sheet.Close>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    size="sm"
                                    data-testid="task-sheet-save"
                                    disabled={!canSave}
                                    text={saving ? t('saving') : t('saveChanges')}
                                />
                            </div>
                        </Sheet.Actions>
                    </form>
                </>
            )}
        </Sheet>
        <ConfirmDialog
            showModal={showDeleteConfirm}
            setShowModal={(next) => {
                const open = typeof next === 'function' ? next(showDeleteConfirm) : next;
                setShowDeleteConfirm(open);
            }}
            tone="danger"
            title={task ? t('deleteConfirmTitle', { title: task.title }) : t('deleteConfirmTitleFallback')}
            description={t('deleteConfirmDescription')}
            confirmLabel={t('deleteConfirmLabel')}
            onConfirm={performDelete}
        />
        </>
    );
}
