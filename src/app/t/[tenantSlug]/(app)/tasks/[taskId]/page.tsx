'use client';

import { formatDate, formatDateTime } from '@/lib/format-date';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { textLinkVariants } from '@/components/ui/typography';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { DataTable, createColumns } from '@/components/ui/table';
import {
    EntityPicker,
    type EntityPickerKind,
} from '@/components/ui/entity-picker';
import { useToastWithUndo } from '@/components/ui/hooks';
import { SkeletonLine } from '@/components/ui/skeleton';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { UserCombobox } from '@/components/ui/user-combobox';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { FieldOperationPanel } from '@/components/ui/map/FieldOperationPanel';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { CopyText } from '@/components/ui/copy-text';
import { TERMINAL_WORK_ITEM_STATUSES } from '@/app-layer/domain/work-item-status';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { MetaStrip } from '@/components/ui/meta-strip';
import {
    TASK_STATUS_VARIANT,
    TASK_SEVERITY_VARIANT,
} from '@/app-layer/domain/entity-status-mapping';
import { cardVariants } from '@/components/ui/card';
// Shared evidence sub-table — lives under the control detail route's
// `_tabs/` (kept there so existing guard exemptions + a unit test keyed
// on that path stay valid). Imported here via the `@/app` alias.
import { EvidenceSubTable } from '@/app/t/[tenantSlug]/(app)/controls/[controlId]/_tabs/EvidenceSubTable';
import { EvidenceAddForm } from '@/components/EvidenceAddForm';
import { EditTaskModal, type EditTaskForm } from './_modals/EditTaskModal';
import { toYMD } from '@/components/ui/date-picker/date-utils';
import { Pen2 } from '@/components/ui/icons/nucleo';
import { cn } from '@/lib/cn';
import { useTranslations } from 'next-intl';

// Polish PR-1 — STATUS_BADGE / SEVERITY_BADGE moved to shared
// domain mapping (TASK_STATUS_VARIANT / TASK_SEVERITY_VARIANT).
// Labels stay local because they're presentation copy.
const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open', TRIAGED: 'Triaged', IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked', PENDING_REVIEW: 'Pending review',
    RESOLVED: 'Resolved', CLOSED: 'Closed', CANCELED: 'Canceled',
};
const PRIORITY_LABELS: Record<string, string> = {
    P0: 'P0 — Critical', P1: 'P1 — High', P2: 'P2 — Medium', P3: 'P3 — Low',
};
const TYPE_LABELS: Record<string, string> = {
    AUDIT_FINDING: 'Audit Finding', CONTROL_GAP: 'Control Gap',
    INCIDENT: 'Incident', IMPROVEMENT: 'Improvement', TASK: 'Task',
};
const ENTITY_TYPE_OPTIONS = ['CONTROL', 'RISK', 'ASSET', 'EVIDENCE', 'FRAMEWORK_REQUIREMENT'];
const ENTITY_TYPE_CB_OPTIONS: ComboboxOption[] = ENTITY_TYPE_OPTIONS.map(t => ({ value: t, label: t }));
const RELATION_OPTIONS = ['RELATES_TO', 'CAUSED_BY', 'MITIGATED_BY', 'EVIDENCE_FOR'];
const RELATION_CB_OPTIONS: ComboboxOption[] = RELATION_OPTIONS.map(r => ({ value: r, label: r.replace(/_/g, ' ') }));
// RESOLVED retired from the picker — it was redundant with CLOSED.
// Kept in STATUS_LABELS so a legacy RESOLVED task still shows the right
// badge; just not offered as a choice (a RESOLVED task is closed via
// the CLOSED option). CLOSED + CANCELED prompt for a resolution note.
const SELECTABLE_STATUSES = ['OPEN', 'TRIAGED', 'IN_PROGRESS', 'BLOCKED', 'CLOSED', 'CANCELED'];
const TASK_STATUS_CB_OPTIONS: ComboboxOption[] = SELECTABLE_STATUSES.map((val) => ({ value: val, label: STATUS_LABELS[val] }));

type Tab = 'overview' | 'evidence' | 'links' | 'comments' | 'activity';

const FINDING_SOURCE_LABELS: Record<string, string> = {
    INTERNAL: 'Internal', EXTERNAL_AUDITOR: 'External Auditor', PEN_TEST: 'Pen Test', INCIDENT: 'Incident',
};
const GAP_TYPE_LABELS: Record<string, string> = {
    DESIGN: 'Design', OPERATING_EFFECTIVENESS: 'Operating Effectiveness', DOCUMENTATION: 'Documentation',
};


export default function TaskDetailPage() {
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, role, tenantSlug } = useTenantContext();
    const taskId = params?.taskId as string;
    const triggerUndoToast = useToastWithUndo();
    const t = useTranslations('tasks.detail');

    const [tab, setTab] = useState<Tab>('overview');

    // Mutation in-flight flags (UI-disable only — not data).
    const [changingStatus, setChangingStatus] = useState(false);
    // Terminal-status close prompt: the status awaiting a resolution
    // note (null = no prompt open) + the note draft + last error.
    const [pendingTerminalStatus, setPendingTerminalStatus] = useState<string | null>(null);
    const [resolutionDraft, setResolutionDraft] = useState('');
    const [statusError, setStatusError] = useState('');
    const [assigning, setAssigning] = useState(false);
    // Assignee-picker draft. `undefined` = untouched (mirror the
    // task's persisted assignee); `string | null` = an explicit pick.
    const [assigneeDraft, setAssigneeDraft] = useState<string | null | undefined>(undefined);

    // Link form state.
    const [showLinkForm, setShowLinkForm] = useState(false);
    const [linkEntityType, setLinkEntityType] = useState('CONTROL');
    const [linkEntityId, setLinkEntityId] = useState('');
    const [linkRelation, setLinkRelation] = useState('RELATES_TO');
    const [savingLink, setSavingLink] = useState(false);

    // Evidence form state — mirrors the control "+ Evidence" form: a
    // single form that either uploads a file OR links a URL.
    const [showEvidenceForm, setShowEvidenceForm] = useState(false);
    const [evidenceUrl, setEvidenceUrl] = useState('');
    const [evidenceNote, setEvidenceNote] = useState('');
    const [fileToUpload, setFileToUpload] = useState<File | null>(null);
    const [fileUploadTitle, setFileUploadTitle] = useState('');
    const [evidenceError, setEvidenceError] = useState('');
    const [savingEvidence, setSavingEvidence] = useState(false);
    const fileUploadRef = useRef<HTMLInputElement>(null);

    // Comment form state.
    const [commentBody, setCommentBody] = useState('');
    const [savingComment, setSavingComment] = useState(false);

    // Edit-task modal state — mirrors the control detail edit flow.
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState<EditTaskForm>({
        title: '', description: '', type: 'TASK', severity: 'MEDIUM', priority: 'P2', dueAt: '',
    });
    const [savingEdit, setSavingEdit] = useState(false);
    const [editError, setEditError] = useState('');

    const canComment = role !== 'READER';

    // #102 item 5 — the page read the task and each tab via raw
    // useState + useEffect + fetch, and every mutation re-fetched the
    // whole task. Migrated to `useTenantSWR` (Epic 69 — the pattern
    // this file's own TODO asked for, and the one the sibling
    // control-detail page uses). Tab data fetches lazily through a
    // null SWR key while its tab is inactive; mutations write the
    // cache through `mutate` — optimistic for instant feedback, then
    // revalidate to reconcile server-derived fields.
    const taskQuery = useTenantSWR<any>(taskId ? `/tasks/${taskId}` : null);
    const task = taskQuery.data ?? null;
    const loading = taskQuery.isLoading;
    const error = taskQuery.error
        ? (taskQuery.error instanceof Error
            ? taskQuery.error.message
            : 'Task not found')
        : '';

    const linksQuery = useTenantSWR<any[]>(
        taskId && tab === 'links' ? `/tasks/${taskId}/links` : null,
    );
    const links = linksQuery.data ?? [];
    const linksLoading = linksQuery.isLoading;

    // Task Evidence tab — same `{ links, evidence }` payload the control
    // evidence tab fetches, so the shared <EvidenceSubTable> renders it.
    const evidenceQuery = useTenantSWR<{ links: any[]; evidence: any[] }>(
        taskId && tab === 'evidence' ? `/tasks/${taskId}/evidence` : null,
    );

    const commentsQuery = useTenantSWR<any[]>(
        taskId && tab === 'comments' ? `/tasks/${taskId}/comments` : null,
    );
    const comments = commentsQuery.data ?? [];
    const commentsLoading = commentsQuery.isLoading;

    const activityQuery = useTenantSWR<any[]>(
        taskId && tab === 'activity' ? `/tasks/${taskId}/activity` : null,
    );
    const activity = activityQuery.data ?? [];
    const activityLoading = activityQuery.isLoading;

    // Effective assignee for the picker — the draft if the user has
    // touched it, otherwise the task's persisted assignee.
    const assigneeValue: string | null =
        assigneeDraft !== undefined
            ? assigneeDraft
            : (task?.assigneeUserId ?? null);

    // A terminal status (CLOSED / CANCELED) requires a resolution note
    // server-side (S8 audit control). Picking one opens a small prompt
    // for the note; non-terminal changes commit immediately.
    const requestStatusChange = (status: string) => {
        setStatusError('');
        if ((TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
            setResolutionDraft('');
            setPendingTerminalStatus(status);
            return;
        }
        void commitStatus(status, null);
    };

    // Review gate (#6) — approve/request-changes a PENDING_REVIEW field op.
    const [reviewComment, setReviewComment] = useState('');
    const [reviewing, setReviewing] = useState(false);
    const submitReview = async (action: 'APPROVE' | 'REQUEST_CHANGES') => {
        setReviewing(true);
        setStatusError('');
        try {
            const res = await fetch(apiUrl(`/field-operations/${taskId}/review`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, comment: reviewComment.trim() || undefined }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error((typeof data?.error === 'string' && data.error) || data?.message || 'Review failed');
            }
            setReviewComment('');
            await taskQuery.mutate();
        } catch (e) {
            setStatusError(e instanceof Error ? e.message : 'Review failed');
        } finally {
            setReviewing(false);
        }
    };

    const commitStatus = async (status: string, resolution: string | null) => {
        setChangingStatus(true);
        setStatusError('');
        try {
            // Optimistic — the new status shows instantly, no spinner.
            await taskQuery.mutate(
                (cur: any) => (cur ? { ...cur, status } : cur),
                { revalidate: false },
            );
            const res = await fetch(apiUrl(`/tasks/${taskId}/status`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    resolution ? { status, resolution } : { status },
                ),
            });
            if (!res.ok) {
                // Surface the reason instead of silently reverting — the
                // old flow swallowed the 4xx and the optimistic patch
                // snapped back, so "nothing happened" on close.
                const data = await res.json().catch(() => ({}));
                throw new Error(
                    (typeof data?.error === 'string' && data.error) ||
                        data?.message ||
                        'Failed to change status',
                );
            }
            setPendingTerminalStatus(null);
        } catch (e) {
            setStatusError(
                e instanceof Error ? e.message : 'Failed to change status',
            );
        } finally {
            setChangingStatus(false);
            // Reconcile — pick up server-derived fields (completedAt,
            // resolution) the optimistic patch can't know (and revert
            // the optimistic status if the write failed).
            await taskQuery.mutate();
        }
    };

    const handleAssign = async () => {
        setAssigning(true);
        const assigneeUserId = assigneeValue || null;
        try {
            await taskQuery.mutate(
                (cur: any) => (cur ? { ...cur, assigneeUserId } : cur),
                { revalidate: false },
            );
            await fetch(apiUrl(`/tasks/${taskId}/assign`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigneeUserId }),
            });
        } finally {
            setAssigning(false);
            await taskQuery.mutate();
        }
    };

    const addLink = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!linkEntityId.trim()) return;
        setSavingLink(true);
        try {
            await fetch(apiUrl(`/tasks/${taskId}/links`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entityType: linkEntityType, entityId: linkEntityId, relation: linkRelation }),
            });
            setLinkEntityId('');
            setShowLinkForm(false);
        } finally {
            setSavingLink(false);
            // Refresh the links list + the task (its _count.links
            // drives the Links tab badge).
            await Promise.all([linksQuery.mutate(), taskQuery.mutate()]);
        }
    };

    // Epic 67 — delayed-commit link removal. Optimistic SWR cache
    // filter so the row disappears immediately; undo restores it,
    // commit-failure rolls back.
    const removeLink = (linkId: string) => {
        const previous = linksQuery.data ?? [];
        void linksQuery.mutate(
            previous.filter((l: any) => l.id !== linkId),
            { revalidate: false },
        );
        triggerUndoToast({
            message: t('linkRemoved'),
            undoMessage: t('undo'),
            action: async () => {
                const res = await fetch(
                    apiUrl(`/tasks/${taskId}/links/${linkId}`),
                    { method: 'DELETE' },
                );
                if (!res.ok) throw new Error('Remove link failed');
            },
            undoAction: () => {
                void linksQuery.mutate(previous, { revalidate: false });
            },
            onError: () => {
                void linksQuery.mutate(previous, { revalidate: false });
            },
        });
    };

    const resetEvidenceForm = () => {
        setEvidenceUrl('');
        setEvidenceNote('');
        setFileToUpload(null);
        setFileUploadTitle('');
        setEvidenceError('');
        if (fileUploadRef.current) fileUploadRef.current.value = '';
        setShowEvidenceForm(false);
    };

    // Unified "+ Evidence" submit — mirrors the control evidence form. A
    // chosen file uploads via /evidence/uploads (FileRecord + Evidence
    // tagged with this taskId); otherwise a non-empty URL links a LINK
    // evidence row to the task. Both land in this task's Evidence tab
    // AND the Evidence Library.
    const addEvidence = async (e: React.FormEvent) => {
        e.preventDefault();
        setEvidenceError('');

        if (fileToUpload) {
            setSavingEvidence(true);
            try {
                const formData = new FormData();
                formData.append('file', fileToUpload);
                if (fileUploadTitle) formData.append('title', fileUploadTitle);
                formData.append('taskId', taskId);
                const res = await fetch(apiUrl('/evidence/uploads'), {
                    method: 'POST',
                    body: formData,
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
                    throw new Error(err.error || err.message || 'Upload failed');
                }
                resetEvidenceForm();
                await Promise.all([evidenceQuery.mutate(), taskQuery.mutate()]);
            } catch (err: unknown) {
                setEvidenceError(err instanceof Error ? err.message : 'Upload failed');
            } finally {
                setSavingEvidence(false);
            }
            return;
        }

        if (!evidenceUrl.trim()) {
            setEvidenceError(t('chooseFileError'));
            return;
        }
        setSavingEvidence(true);
        try {
            const res = await fetch(apiUrl(`/tasks/${taskId}/evidence`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: evidenceUrl.trim(), note: evidenceNote || undefined }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || err.message || 'Failed to link evidence');
            }
            resetEvidenceForm();
            await Promise.all([evidenceQuery.mutate(), taskQuery.mutate()]);
        } catch (err: unknown) {
            setEvidenceError(err instanceof Error ? err.message : 'Failed to link evidence');
        } finally {
            setSavingEvidence(false);
        }
    };

    // Epic 67 — delayed-commit evidence removal (detach Evidence.taskId).
    // Optimistic SWR filter so the row disappears immediately; undo
    // restores it, commit-failure rolls back.
    const removeEvidence = (evidenceId: string) => {
        const previous = evidenceQuery.data;
        void evidenceQuery.mutate(
            previous
                ? { ...previous, evidence: (previous.evidence ?? []).filter((ev: any) => ev.id !== evidenceId) }
                : previous,
            { revalidate: false },
        );
        triggerUndoToast({
            message: t('evidenceRemoved'),
            undoMessage: t('undo'),
            action: async () => {
                const res = await fetch(
                    apiUrl(`/tasks/${taskId}/evidence/${evidenceId}`),
                    { method: 'DELETE' },
                );
                if (!res.ok) throw new Error('Remove evidence failed');
                await Promise.all([evidenceQuery.mutate(), taskQuery.mutate()]);
            },
            undoAction: () => {
                void evidenceQuery.mutate(previous, { revalidate: false });
            },
            onError: () => {
                void evidenceQuery.mutate(previous, { revalidate: false });
            },
        });
    };

    const openEditModal = () => {
        if (!task) return;
        setEditError('');
        setEditForm({
            title: task.title ?? '',
            description: task.description ?? '',
            type: task.type ?? 'TASK',
            severity: task.severity ?? 'MEDIUM',
            priority: task.priority ?? 'P2',
            dueAt: task.dueAt ? toYMD(new Date(task.dueAt)) ?? '' : '',
        });
        setShowEditModal(true);
    };

    const handleEditSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingEdit(true);
        setEditError('');
        try {
            const res = await fetch(apiUrl(`/tasks/${taskId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editForm.title,
                    description: editForm.description || null,
                    type: editForm.type,
                    severity: editForm.severity,
                    priority: editForm.priority,
                    dueAt: editForm.dueAt
                        ? new Date(editForm.dueAt).toISOString()
                        : null,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(
                    (typeof data?.error === 'string' && data.error) ||
                        data?.message ||
                        'Failed to save task',
                );
            }
            setShowEditModal(false);
            await taskQuery.mutate();
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Failed to save task');
        } finally {
            setSavingEdit(false);
        }
    };

    const addComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!commentBody.trim()) return;
        setSavingComment(true);
        try {
            await fetch(apiUrl(`/tasks/${taskId}/comments`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: commentBody }),
            });
            setCommentBody('');
        } finally {
            setSavingComment(false);
            await Promise.all([commentsQuery.mutate(), taskQuery.mutate()]);
        }
    };

    const breadcrumbs = [
        { label: t('dashboard'), href: tenantHref('/dashboard') },
        { label: t('breadcrumbTasks'), href: tenantHref('/tasks') },
        { label: task?.title ?? t('taskFallback') },
    ];
    if (loading) {
        return (
            <EntityDetailLayout loading title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (error) {
        return (
            <EntityDetailLayout error={error} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (!task) {
        return (
            <EntityDetailLayout empty={{ message: t('notFound') }} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }

    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'overview', label: t('tabOverview') },
        { key: 'evidence', label: t('tabEvidence'), count: evidenceQuery.data?.evidence?.length ?? task._count?.evidence },
        { key: 'links', label: t('tabLinks'), count: task._count?.links ?? links.length },
        { key: 'comments', label: t('tabComments'), count: task._count?.comments ?? comments.length },
        { key: 'activity', label: t('tabActivity') },
    ];

    const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && !(TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(task.status);
    const metadata = task.metadataJson || {};

    return (
        <EntityDetailLayout
            id="task-detail-page"
            breadcrumbs={breadcrumbs}

            title={<span id="task-title">{task.title}</span>}
            meta={
                <MetaStrip
                    items={[
                        ...(task.key
                            ? [
                                  {
                                      label: t('metaKey'),
                                      value: (
                                          <CopyText
                                              value={task.key}
                                              label={t('copyTaskKey', { key: task.key })}
                                              successMessage={t('taskKeyCopied')}
                                              className="text-xs text-content-subtle"
                                          >
                                              {task.key}
                                          </CopyText>
                                      ),
                                  } as const,
                              ]
                            : []),
                        {
                            kind: 'status' as const,
                            id: 'task-status',
                            label: t('metaStatus'),
                            value:
                                STATUS_LABELS[task.status] ?? task.status,
                            variant:
                                TASK_STATUS_VARIANT[task.status] ??
                                'neutral',
                        },
                        {
                            kind: 'status' as const,
                            id: 'task-severity',
                            label: t('metaSeverity'),
                            value: task.severity,
                            variant:
                                TASK_SEVERITY_VARIANT[task.severity] ??
                                'neutral',
                        },
                        {
                            label: t('metaType'),
                            value: TYPE_LABELS[task.type] ?? task.type,
                        },
                        ...(isOverdue
                            ? [
                                  {
                                      kind: 'status' as const,
                                      label: t('metaSla'),
                                      value: t('overdue'),
                                      variant: 'error' as const,
                                  },
                              ]
                            : []),
                    ]}
                />
            }
            actions={
                permissions.canWrite && (
                    <Combobox
                        hideSearch
                        id="task-status-select"
                        selected={TASK_STATUS_CB_OPTIONS.find(o => o.value === task.status) ?? null}
                        setSelected={(opt) => { if (opt) requestStatusChange(opt.value); }}
                        options={TASK_STATUS_CB_OPTIONS}
                        disabled={changingStatus}
                        placeholder={t('statusPlaceholder')}
                        buttonProps={{ className: 'text-sm' }}
                    />
                )
            }
            tabs={tabs}
            activeTab={tab}
            onTabChange={(next) => setTab(next as Tab)}
        >
            {/* Assignment controls */}
            {permissions.canWrite && (
                <div className={cardVariants({ density: 'compact' })}>
                    <div className="flex items-center gap-compact">
                        <span className="text-sm text-content-muted">{t('assigneeLabel')}</span>
                        <span className="text-sm text-content-emphasis font-medium" id="task-assignee">
                            {task.assignee?.name || task.assigneeUserId || t('unassigned')}
                        </span>
                        <div className="w-64">
                            <UserCombobox
                                id="task-assignee-input"
                                name="assigneeUserId"
                                tenantSlug={tenantSlug}
                                selectedId={assigneeValue}
                                onChange={(userId) =>
                                    setAssigneeDraft(userId ?? null)
                                }
                                placeholder={t('unassigned')}
                                forceDropdown={false}
                            />
                        </div>
                        <Button variant="secondary" onClick={handleAssign} disabled={assigning} id="assign-task-btn">
                            {assigning ? t('saving') : t('assign')}
                        </Button>
                    </div>
                </div>
            )}

            {/* Overview Tab */}
            {tab === 'overview' && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    {task && task.type === 'FIELD_OPERATION' && (
                        <div className="border-b border-border-subtle pb-section">
                            <Heading level={3} className="mb-3">{t('fieldOperation')}</Heading>
                            <FieldOperationPanel taskId={task.id} />
                            {/* Review gate (#6): a completed field op awaits an
                                ADMIN reviewer's approval before it's final. */}
                            {task.status === 'PENDING_REVIEW' && permissions.canAdmin && (
                                <div className="mt-default space-y-default rounded-lg border border-border-emphasis bg-bg-subtle p-4">
                                    <p className="text-sm font-medium text-content-emphasis">{t('review.title')}</p>
                                    <p className="text-xs text-content-muted">{t('review.hint')}</p>
                                    <FormField label={t('review.commentLabel')}>
                                        <textarea
                                            value={reviewComment}
                                            onChange={(e) => setReviewComment(e.target.value)}
                                            rows={2}
                                            className="block w-full rounded-md border border-border-subtle bg-bg-default px-3 py-1.5 text-sm"
                                            placeholder={t('review.commentPlaceholder')}
                                        />
                                    </FormField>
                                    <div className="flex gap-compact">
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            loading={reviewing}
                                            onClick={() => submitReview('APPROVE')}
                                            id="review-approve-btn"
                                        >
                                            {t('review.approve')}
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={reviewing}
                                            onClick={() => submitReview('REQUEST_CHANGES')}
                                            id="review-request-changes-btn"
                                        >
                                            {t('review.requestChanges')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {/* Overview header with Edit button — mirrors the
                        control detail overview edit affordance. */}
                    {permissions.canWrite && (
                        <div className="flex justify-end -mt-1 -mb-2">
                            <Button
                                variant="secondary"
                                size="icon"
                                onClick={openEditModal}
                                data-testid="task-edit-button"
                                id="task-edit-button"
                                aria-label={t('editTask')}
                                title={t('editTask')}
                            >
                                <Pen2 className="size-4" />
                            </Button>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-section">
                        <div className="col-span-2">
                            <span className="text-xs text-content-subtle uppercase">{t('description')}</span>
                            <p className="text-sm text-content-default mt-1 whitespace-pre-wrap">{task.description || t('noDescription')}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('type')}</span>
                            <p className="text-sm text-content-default mt-1">{TYPE_LABELS[task.type] || task.type}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('priority')}</span>
                            <p className="text-sm text-content-default mt-1">{PRIORITY_LABELS[task.priority] || task.priority}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('assignee')}</span>
                            <p className="text-sm text-content-default mt-1">{task.assignee?.name || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('reporter')}</span>
                            <p className="text-sm text-content-default mt-1">{task.createdBy?.name || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('dueDate')}</span>
                            <p className="text-sm text-content-default mt-1">{task.dueAt ? formatDate(task.dueAt) : '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('created')}</span>
                            <p className="text-sm text-content-default mt-1">{formatDateTime(task.createdAt)}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('createdBy')}</span>
                            <p className="text-sm text-content-default mt-1">{task.createdBy?.name || '—'}</p>
                        </div>
                        {task.control && (
                            <div>
                                <span className="text-xs text-content-subtle uppercase">{t('control')}</span>
                                <p className="text-sm mt-1">
                                    <Link
                                        href={tenantHref(`/controls/${task.control.id}`)}
                                        className={textLinkVariants({ tone: 'link' })}
                                        id="task-control-link"
                                    >
                                        {task.control.code} — {task.control.name}
                                    </Link>
                                </p>
                            </div>
                        )}
                        {task.completedAt && (
                            <div>
                                <span className="text-xs text-content-subtle uppercase">{t('completedAt')}</span>
                                <p className="text-sm text-content-success mt-1">{formatDateTime(task.completedAt)}</p>
                            </div>
                        )}
                        {task.resolution && (
                            <div className="col-span-2">
                                <span className="text-xs text-content-subtle uppercase">{t('resolution')}</span>
                                <p className="text-sm text-content-default mt-1 whitespace-pre-wrap">{task.resolution}</p>
                            </div>
                        )}
                    </div>

                    {/* Audit / Finding Fields from metadataJson */}
                    {(task.type === 'AUDIT_FINDING' || task.type === 'CONTROL_GAP') && (metadata.findingSource || metadata.controlGapType) && (
                        <div className="border-t border-border-default pt-4 mt-4">
                            <Heading level={3} className="mb-3">{t('auditDetails')}</Heading>
                            <div className="grid grid-cols-2 gap-default">
                                {metadata.findingSource && (
                                    <div>
                                        <span className="text-xs text-content-subtle uppercase">{t('findingSource')}</span>
                                        <p className="text-sm text-content-default mt-1">{FINDING_SOURCE_LABELS[metadata.findingSource] || metadata.findingSource}</p>
                                    </div>
                                )}
                                {metadata.controlGapType && (
                                    <div>
                                        <span className="text-xs text-content-subtle uppercase">{t('controlGapType')}</span>
                                        <p className="text-sm text-content-default mt-1">{GAP_TYPE_LABELS[metadata.controlGapType] || metadata.controlGapType}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Evidence Tab — same look + behaviour as the control
                Evidence tab: upload a file OR link a URL, both scoped to
                this task via Evidence.taskId. */}
            {tab === 'evidence' && (
                <div className="space-y-default">
                    <EvidenceAddForm
                        ids={{
                            trigger: 'add-evidence-btn',
                            form: 'task-evidence-form',
                            title: 'task-upload-title',
                            file: 'evidence-file-input',
                            url: 'evidence-url-input',
                            note: 'evidence-note-input',
                            error: 'task-evidence-error',
                            submit: 'submit-evidence-btn',
                        }}
                        canWrite={!!permissions.canWrite}
                        show={showEvidenceForm}
                        onToggleShow={() => setShowEvidenceForm(!showEvidenceForm)}
                        file={fileToUpload}
                        onFileChange={(f) => {
                            setFileToUpload(f);
                            if (f && !fileUploadTitle) setFileUploadTitle(f.name);
                        }}
                        fileInputRef={fileUploadRef}
                        title={fileUploadTitle}
                        onTitleChange={setFileUploadTitle}
                        url={evidenceUrl}
                        onUrlChange={setEvidenceUrl}
                        note={evidenceNote}
                        onNoteChange={setEvidenceNote}
                        onSubmit={addEvidence}
                        error={evidenceError}
                        uploading={savingEvidence && !!fileToUpload}
                        saving={savingEvidence && !fileToUpload}
                    />
                    {evidenceQuery.error ? (
                        <InlineEmptyState
                            title={t('evidenceLoadErrorTitle')}
                            description={t('evidenceLoadErrorDescription')}
                        />
                    ) : (
                        <EvidenceSubTable
                            data={evidenceQuery.data}
                            loading={evidenceQuery.isLoading && !evidenceQuery.data}
                            canWrite={!!permissions.canWrite}
                            onUnlink={() => {}}
                            onUnlinkEvidence={removeEvidence}
                            tenantHref={tenantHref}
                        />
                    )}
                </div>
            )}

            {/* Links Tab */}
            {tab === 'links' && (
                <div className="space-y-default">
                    {permissions.canWrite && (
                        <div className="flex justify-end">
                            <Button variant="primary" onClick={() => setShowLinkForm(!showLinkForm)} id="add-link-btn">
                                + Link
                            </Button>
                        </div>
                    )}
                    {showLinkForm && permissions.canWrite && (
                        <form onSubmit={addLink} className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                            <div className="grid grid-cols-3 gap-compact">
                                <Combobox hideSearch id="link-entity-type" selected={ENTITY_TYPE_CB_OPTIONS.find(o => o.value === linkEntityType) ?? null} setSelected={(opt) => setLinkEntityType(opt?.value ?? linkEntityType)} options={ENTITY_TYPE_CB_OPTIONS} matchTriggerWidth />
                                {/* PR-D — entity picker replaces the
                                    legacy "Paste ID" `<input>`. The
                                    type Combobox to the left drives
                                    which candidate set the picker
                                    fetches; selecting from the list
                                    writes the cuid into linkEntityId
                                    so the existing addLink handler
                                    is unchanged. */}
                                <EntityPicker
                                    tenantSlug={tenantSlug}
                                    entityType={linkEntityType as EntityPickerKind}
                                    value={linkEntityId}
                                    onChange={setLinkEntityId}
                                    id="link-entity-id"
                                    testId="task-link-entity-picker"
                                    placeholder="Select entity"
                                />
                                <Combobox hideSearch id="link-relation" selected={RELATION_CB_OPTIONS.find(o => o.value === linkRelation) ?? null} setSelected={(opt) => setLinkRelation(opt?.value ?? linkRelation)} options={RELATION_CB_OPTIONS} matchTriggerWidth />
                            </div>
                            <Button type="submit" variant="primary" disabled={savingLink} id="submit-link-btn">
                                {savingLink ? t('linking') : t('linkAction')}
                            </Button>
                        </form>
                    )}
                    <TaskLinksTable
                        links={links}
                        loading={linksLoading}
                        canWrite={!!permissions.canWrite}
                        onRemove={removeLink}
                    />
                </div>
            )}

            {/* Comments Tab */}
            {tab === 'comments' && (
                <div className="space-y-default">
                    {canComment && (
                        <form onSubmit={addComment} className={cn(cardVariants({ density: 'compact' }), 'space-y-compact')}>
                            <textarea
                                className="input w-full"
                                rows={3}
                                placeholder={t('commentPlaceholder')}
                                value={commentBody}
                                onChange={e => setCommentBody(e.target.value)}
                                required
                                id="comment-body"
                            />
                            <Button type="submit" variant="primary" disabled={savingComment} id="submit-comment-btn">
                                {savingComment ? t('posting') : t('commentAction')}
                            </Button>
                        </form>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')} id="comments-list">
                        {commentsLoading ? (
                            <div className="p-4 space-y-compact">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="space-y-1">
                                        <SkeletonLine className="w-32" />
                                        <SkeletonLine className="w-full" />
                                    </div>
                                ))}
                            </div>
                        ) : comments.length === 0 ? (
                            <InlineEmptyState
                                title={t('noCommentsTitle')}
                                description={t('noCommentsDescription')}
                            />
                        ) : (
                            <div className="divide-y divide-border-default/50">
                                {comments.map((c: any) => (
                                    <div key={c.id} className="px-5 py-3">
                                        <div className="flex items-center gap-tight mb-1">
                                            <span className="text-sm font-medium text-content-emphasis">{c.createdBy?.name || t('unknownUser')}</span>
                                            <span className="text-xs text-content-subtle">{formatDateTime(c.createdAt)}</span>
                                        </div>
                                        <p className="text-sm text-content-default whitespace-pre-wrap">{c.body}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Activity Tab */}
            {tab === 'activity' && (
                <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')} id="activity-list">
                    {activityLoading ? (
                        <div className="p-4 space-y-compact">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex items-start gap-compact">
                                    <div className="animate-pulse rounded-full bg-bg-elevated/60 w-2 h-2 mt-2" />
                                    <div className="flex-1 space-y-1">
                                        <SkeletonLine className="w-48" />
                                        <SkeletonLine className="w-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : activity.length === 0 ? (
                        <InlineEmptyState
                            title={t('noActivityTitle')}
                            description={t('noActivityDescription')}
                        />
                    ) : (
                        <div className="divide-y divide-border-default/50">
                            {activity.map((evt: any) => (
                                <div key={evt.id} className="px-5 py-3 flex items-start gap-compact">
                                    <div className="w-2 h-2 rounded-full bg-[var(--brand-default)] mt-2 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-tight mb-0.5">
                                            <span className="text-sm font-medium text-content-emphasis">{evt.user?.name || t('systemUser')}</span>
                                            <StatusBadge variant="neutral">{evt.action?.replace(/_/g, ' ')}</StatusBadge>
                                        </div>
                                        <p className="text-xs text-content-muted truncate">{evt.details?.split('\n')[0]}</p>
                                        <span className="text-xs text-content-subtle">{formatDateTime(evt.createdAt)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Resolution prompt — moving a task to a terminal status
                (CLOSED / CANCELED) records a resolution note on the
                audit trail (S8). Collected here so closing actually
                works instead of silently reverting on the 4xx. */}
            <Modal
                showModal={pendingTerminalStatus !== null}
                setShowModal={(next) => {
                    if (next === false && !changingStatus) {
                        setPendingTerminalStatus(null);
                    }
                }}
                size="sm"
                title={`${STATUS_LABELS[pendingTerminalStatus ?? ''] ?? t('closeFallback')} ${t('taskWord')}`}
                description={t('resolutionModalDescription')}
                preventDefaultClose={changingStatus}
            >
                <Modal.Header
                    title={`${STATUS_LABELS[pendingTerminalStatus ?? ''] ?? t('closeFallback')} ${t('taskWord')}`}
                    description={t('resolutionModalHeaderDescription')}
                />
                <Modal.Body>
                    {statusError && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            role="alert"
                            id="task-status-error"
                        >
                            {statusError}
                        </div>
                    )}
                    <FormField label={t('resolutionField')} required>
                        <textarea
                            id="task-resolution-input"
                            className="input w-full"
                            rows={3}
                            placeholder={t('resolutionPlaceholder')}
                            value={resolutionDraft}
                            onChange={(e) => setResolutionDraft(e.target.value)}
                            disabled={changingStatus}
                        />
                    </FormField>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPendingTerminalStatus(null)}
                        disabled={changingStatus}
                        id="task-status-cancel-btn"
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        id="confirm-task-status-btn"
                        disabled={!resolutionDraft.trim() || changingStatus}
                        onClick={() =>
                            pendingTerminalStatus &&
                            commitStatus(
                                pendingTerminalStatus,
                                resolutionDraft.trim(),
                            )
                        }
                    >
                        {changingStatus
                            ? t('savingEllipsis')
                            : `${STATUS_LABELS[pendingTerminalStatus ?? ''] ?? t('closeFallback')} ${t('taskWord')}`}
                    </Button>
                </Modal.Actions>
            </Modal>

            {/* Edit-task modal — page owns state + mutation, the modal
                is a thin renderer (control-detail parity). */}
            <EditTaskModal
                open={showEditModal}
                setOpen={setShowEditModal}
                form={editForm}
                setForm={setEditForm}
                saving={savingEdit}
                error={editError}
                onCancel={() => setShowEditModal(false)}
                onSubmit={handleEditSave}
            />
        </EntityDetailLayout>
    );
}

// R11-PR8 — task links sub-table routed through DataTable. Inline
// columns derive from the same fields the prior raw <table> rendered;
// canWrite gates the Remove action column. `loading` proxies to
// DataTable's built-in skeleton (which inherits R11-PR2's shimmer).
interface TaskLinkRow {
    id: string;
    entityType: string;
    entityId: string;
    relation?: string | null;
    createdAt: string;
}

function TaskLinksTable({
    links,
    loading,
    canWrite,
    onRemove,
}: {
    links: TaskLinkRow[];
    loading: boolean;
    canWrite: boolean;
    onRemove: (id: string) => void;
}) {
    const t = useTranslations('tasks.detail.links');
    const columns = useMemo(
        () =>
            createColumns<TaskLinkRow>([
                {
                    id: 'entityType',
                    header: t('colType'),
                    cell: ({ row }) => (
                        <StatusBadge variant="info">{row.original.entityType}</StatusBadge>
                    ),
                },
                {
                    id: 'entityId',
                    header: t('colEntityId'),
                    cell: ({ row }) => (
                        <span className="text-sm text-content-default font-mono">
                            {row.original.entityId}
                        </span>
                    ),
                },
                {
                    id: 'relation',
                    header: t('colRelation'),
                    cell: ({ row }) => (
                        <span className="text-xs text-content-muted">
                            {row.original.relation?.replace(/_/g, ' ') || '—'}
                        </span>
                    ),
                },
                {
                    id: 'createdAt',
                    header: t('colCreated'),
                    cell: ({ row }) => (
                        <span className="text-xs text-content-muted">
                            {formatDate(row.original.createdAt)}
                        </span>
                    ),
                },
                ...(canWrite
                    ? [
                          {
                              id: 'actions',
                              header: t('colActions'),
                              cell: ({ row }) => (
                                  <button
                                      className="text-content-error text-xs hover:text-content-error"
                                      onClick={() => onRemove(row.original.id)}
                                  >
                                      × Remove
                                  </button>
                              ),
                          } as Parameters<typeof createColumns<TaskLinkRow>>[0][number],
                      ]
                    : []),
            ]),
        [canWrite, onRemove, t],
    );
    return (
        <DataTable
            data={links}
            columns={columns}
            getRowId={(l) => l.id}
            loading={loading}
            emptyState={
                <InlineEmptyState
                    title={t('noLinksTitle')}
                    description={t('noLinksDescription')}
                />
            }
            resourceName={(p) => (p ? 'links' : 'link')}
            data-testid="task-links-table"
        />
    );
}
