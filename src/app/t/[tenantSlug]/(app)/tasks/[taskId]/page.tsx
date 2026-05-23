'use client';

import { formatDate, formatDateTime } from '@/lib/format-date';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { DataTable, createColumns } from '@/components/ui/table';
import { useToastWithUndo } from '@/components/ui/hooks';
import { SkeletonLine } from '@/components/ui/skeleton';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { UserCombobox } from '@/components/ui/user-combobox';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
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
import { cn } from '@dub/utils';

// Polish PR-1 — STATUS_BADGE / SEVERITY_BADGE moved to shared
// domain mapping (TASK_STATUS_VARIANT / TASK_SEVERITY_VARIANT).
// Labels stay local because they're presentation copy.
const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open', TRIAGED: 'Triaged', IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked', RESOLVED: 'Resolved', CLOSED: 'Closed', CANCELED: 'Canceled',
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
const TASK_STATUS_CB_OPTIONS: ComboboxOption[] = Object.entries(STATUS_LABELS).map(([val, lbl]) => ({ value: val, label: lbl }));

type Tab = 'overview' | 'links' | 'comments' | 'activity';

const FINDING_SOURCE_LABELS: Record<string, string> = {
    INTERNAL: 'Internal', EXTERNAL_AUDITOR: 'External Auditor', PEN_TEST: 'Pen Test', INCIDENT: 'Incident',
};
const GAP_TYPE_LABELS: Record<string, string> = {
    DESIGN: 'Design', OPERATING_EFFECTIVENESS: 'Operating Effectiveness', DOCUMENTATION: 'Documentation',
};

// SLA windows (hours)
const SLA_RESOLVE: Record<string, number> = { CRITICAL: 24, HIGH: 72, MEDIUM: 168, LOW: 720 };
const SLA_TRIAGE: Record<string, number> = { CRITICAL: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

function getSlaStatus(severity: string, createdAt: string, status: string) {
    if ((TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(status)) return { label: '', breach: false };
    const now = Date.now();
    const created = new Date(createdAt).getTime();
    const resolveH = SLA_RESOLVE[severity];
    const triageH = SLA_TRIAGE[severity];
    if (resolveH && now > created + resolveH * 3600000) return { label: 'SLA Breached', breach: true };
    if (triageH && status === 'OPEN' && now > created + triageH * 3600000) return { label: 'Triage SLA Breached', breach: true };
    return { label: '', breach: false };
}

// Relevance check: AUDIT_FINDING/CONTROL_GAP needs control/framework link; INCIDENT needs asset/control
function getRelevanceStatus(task: any, links: any[]) {
    const type = task?.type;
    if (!type) return { satisfied: true, message: '' };
    const hasControl = !!task.controlId || links.some((l: any) => l.entityType === 'CONTROL');
    const hasFramework = links.some((l: any) => l.entityType === 'FRAMEWORK_REQUIREMENT');
    const hasAsset = links.some((l: any) => l.entityType === 'ASSET');

    if (['AUDIT_FINDING', 'CONTROL_GAP'].includes(type) && !hasControl && !hasFramework) {
        return { satisfied: false, message: 'Requires a Control or Framework Requirement link' };
    }
    if (type === 'INCIDENT' && !hasAsset && !hasControl) {
        return { satisfied: false, message: 'Requires an Asset or Control link' };
    }
    return { satisfied: true, message: '' };
}

export default function TaskDetailPage() {
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, role, tenantSlug } = useTenantContext();
    const taskId = params?.taskId as string;
    const triggerUndoToast = useToastWithUndo();

    const [tab, setTab] = useState<Tab>('overview');

    // Mutation in-flight flags (UI-disable only — not data).
    const [changingStatus, setChangingStatus] = useState(false);
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

    // Comment form state.
    const [commentBody, setCommentBody] = useState('');
    const [savingComment, setSavingComment] = useState(false);

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

    const changeStatus = async (status: string) => {
        setChangingStatus(true);
        try {
            // Optimistic — the new status shows instantly, no spinner.
            await taskQuery.mutate(
                (cur: any) => (cur ? { ...cur, status } : cur),
                { revalidate: false },
            );
            await fetch(apiUrl(`/tasks/${taskId}/status`), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
        } finally {
            setChangingStatus(false);
            // Reconcile — pick up server-derived fields (completedAt,
            // resolution) the optimistic patch can't know.
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
            message: 'Link removed',
            undoMessage: 'Undo',
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
        { label: 'Dashboard', href: tenantHref('/dashboard') },
        { label: 'Tasks', href: tenantHref('/tasks') },
        { label: task?.title ?? 'Task' },
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
            <EntityDetailLayout empty={{ message: 'Task not found.' }} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }

    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'links', label: 'Links', count: task._count?.links ?? links.length },
        { key: 'comments', label: 'Comments', count: task._count?.comments ?? comments.length },
        { key: 'activity', label: 'Activity' },
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
                                      label: 'Key',
                                      value: (
                                          <CopyText
                                              value={task.key}
                                              label={`Copy task key ${task.key}`}
                                              successMessage="Task key copied"
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
                            label: 'Status',
                            value:
                                STATUS_LABELS[task.status] ?? task.status,
                            variant:
                                TASK_STATUS_VARIANT[task.status] ??
                                'neutral',
                        },
                        {
                            kind: 'status' as const,
                            id: 'task-severity',
                            label: 'Severity',
                            value: task.severity,
                            variant:
                                TASK_SEVERITY_VARIANT[task.severity] ??
                                'neutral',
                        },
                        {
                            label: 'Type',
                            value: TYPE_LABELS[task.type] ?? task.type,
                        },
                        ...(isOverdue
                            ? [
                                  {
                                      kind: 'status' as const,
                                      label: 'SLA',
                                      value: 'Overdue',
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
                        setSelected={(opt) => { if (opt) changeStatus(opt.value); }}
                        options={TASK_STATUS_CB_OPTIONS}
                        disabled={changingStatus}
                        placeholder="Status"
                        matchTriggerWidth
                        buttonProps={{ className: 'w-40 text-sm' }}
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
                        <span className="text-sm text-content-muted">Assignee:</span>
                        <span className="text-sm text-content-emphasis font-medium" id="task-assignee">
                            {task.assignee?.name || task.assigneeUserId || 'Unassigned'}
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
                                placeholder="Unassigned"
                                forceDropdown={false}
                            />
                        </div>
                        <Button variant="secondary" onClick={handleAssign} disabled={assigning} id="assign-task-btn">
                            {assigning ? 'Saving...' : 'Assign'}
                        </Button>
                    </div>
                </div>
            )}

            {/* Overview Tab */}
            {tab === 'overview' && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    <div className="grid grid-cols-2 gap-section">
                        <div className="col-span-2">
                            <span className="text-xs text-content-subtle uppercase">Description</span>
                            <p className="text-sm text-content-default mt-1 whitespace-pre-wrap">{task.description || 'No description.'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Type</span>
                            <p className="text-sm text-content-default mt-1">{TYPE_LABELS[task.type] || task.type}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Priority</span>
                            <p className="text-sm text-content-default mt-1">{PRIORITY_LABELS[task.priority] || task.priority}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Assignee</span>
                            <p className="text-sm text-content-default mt-1">{task.assignee?.name || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Reporter</span>
                            <p className="text-sm text-content-default mt-1">{task.createdBy?.name || '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Due Date</span>
                            <p className="text-sm text-content-default mt-1">{task.dueAt ? formatDate(task.dueAt) : '—'}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Created</span>
                            <p className="text-sm text-content-default mt-1">{formatDateTime(task.createdAt)}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">Created By</span>
                            <p className="text-sm text-content-default mt-1">{task.createdBy?.name || '—'}</p>
                        </div>
                        {task.control && (
                            <div>
                                <span className="text-xs text-content-subtle uppercase">Control</span>
                                <p className="text-sm text-content-default mt-1">{task.control.code} — {task.control.name}</p>
                            </div>
                        )}
                        {task.completedAt && (
                            <div>
                                <span className="text-xs text-content-subtle uppercase">Completed At</span>
                                <p className="text-sm text-content-success mt-1">{formatDateTime(task.completedAt)}</p>
                            </div>
                        )}
                        {task.resolution && (
                            <div className="col-span-2">
                                <span className="text-xs text-content-subtle uppercase">Resolution</span>
                                <p className="text-sm text-content-default mt-1 whitespace-pre-wrap">{task.resolution}</p>
                            </div>
                        )}
                    </div>

                    {/* Audit / Finding Fields from metadataJson */}
                    {(task.type === 'AUDIT_FINDING' || task.type === 'CONTROL_GAP') && (metadata.findingSource || metadata.controlGapType) && (
                        <div className="border-t border-border-default pt-4 mt-4">
                            <Heading level={3} className="mb-3">Audit Details</Heading>
                            <div className="grid grid-cols-2 gap-default">
                                {metadata.findingSource && (
                                    <div>
                                        <span className="text-xs text-content-subtle uppercase">Finding Source</span>
                                        <p className="text-sm text-content-default mt-1">{FINDING_SOURCE_LABELS[metadata.findingSource] || metadata.findingSource}</p>
                                    </div>
                                )}
                                {metadata.controlGapType && (
                                    <div>
                                        <span className="text-xs text-content-subtle uppercase">Control Gap Type</span>
                                        <p className="text-sm text-content-default mt-1">{GAP_TYPE_LABELS[metadata.controlGapType] || metadata.controlGapType}</p>
                                    </div>
                                )}
                            </div>
                        </div>
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
                                <input type="text" className="input" placeholder="Entity ID *" value={linkEntityId} onChange={e => setLinkEntityId(e.target.value)} required id="link-entity-id" />
                                <Combobox hideSearch id="link-relation" selected={RELATION_CB_OPTIONS.find(o => o.value === linkRelation) ?? null} setSelected={(opt) => setLinkRelation(opt?.value ?? linkRelation)} options={RELATION_CB_OPTIONS} matchTriggerWidth />
                            </div>
                            <Button type="submit" variant="primary" disabled={savingLink} id="submit-link-btn">
                                {savingLink ? 'Linking...' : '+ Link'}
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
                                placeholder="Add a comment..."
                                value={commentBody}
                                onChange={e => setCommentBody(e.target.value)}
                                required
                                id="comment-body"
                            />
                            <Button type="submit" variant="primary" disabled={savingComment} id="submit-comment-btn">
                                {savingComment ? 'Posting...' : '+ Comment'}
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
                                title="No comments yet"
                                description="Use the comment box above to leave context, observations, or questions."
                            />
                        ) : (
                            <div className="divide-y divide-border-default/50">
                                {comments.map((c: any) => (
                                    <div key={c.id} className="px-5 py-3">
                                        <div className="flex items-center gap-tight mb-1">
                                            <span className="text-sm font-medium text-content-emphasis">{c.createdBy?.name || 'Unknown'}</span>
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
                            title="No activity yet"
                            description="Status changes, assignments, and link updates show up here once anything moves."
                        />
                    ) : (
                        <div className="divide-y divide-border-default/50">
                            {activity.map((evt: any) => (
                                <div key={evt.id} className="px-5 py-3 flex items-start gap-compact">
                                    <div className="w-2 h-2 rounded-full bg-[var(--brand-default)] mt-2 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-tight mb-0.5">
                                            <span className="text-sm font-medium text-content-emphasis">{evt.user?.name || 'System'}</span>
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
    const columns = useMemo(
        () =>
            createColumns<TaskLinkRow>([
                {
                    id: 'entityType',
                    header: 'Type',
                    cell: ({ row }) => (
                        <StatusBadge variant="info">{row.original.entityType}</StatusBadge>
                    ),
                },
                {
                    id: 'entityId',
                    header: 'Entity ID',
                    cell: ({ row }) => (
                        <span className="text-sm text-content-default font-mono">
                            {row.original.entityId}
                        </span>
                    ),
                },
                {
                    id: 'relation',
                    header: 'Relation',
                    cell: ({ row }) => (
                        <span className="text-xs text-content-muted">
                            {row.original.relation?.replace(/_/g, ' ') || '—'}
                        </span>
                    ),
                },
                {
                    id: 'createdAt',
                    header: 'Created',
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
                              header: 'Actions',
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
        [canWrite, onRemove],
    );
    return (
        <DataTable
            data={links}
            columns={columns}
            getRowId={(l) => l.id}
            loading={loading}
            emptyState={
                <InlineEmptyState
                    title="No links yet"
                    description="Cross-link this task to related tasks, controls, evidence, or risks via + Link."
                />
            }
            resourceName={(p) => (p ? 'links' : 'link')}
            data-testid="task-links-table"
        />
    );
}
