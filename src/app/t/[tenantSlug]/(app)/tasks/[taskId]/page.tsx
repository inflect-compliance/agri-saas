'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate, formatDateTime } from '@/lib/format-date';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppIcon } from '@/components/icons/AppIcon';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { useToastWithUndo } from '@/components/ui/hooks';
import { SkeletonLine, SkeletonCard } from '@/components/ui/skeleton';
import { UserCombobox } from '@/components/ui/user-combobox';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { CopyText } from '@/components/ui/copy-text';
import { TERMINAL_WORK_ITEM_STATUSES } from '@/app-layer/domain/work-item-status';

const STATUS_BADGE: Record<string, string> = {
    OPEN: 'badge-neutral', TRIAGED: 'badge-info', IN_PROGRESS: 'badge-info',
    BLOCKED: 'badge-danger', RESOLVED: 'badge-success', CLOSED: 'badge-neutral', CANCELED: 'badge-neutral',
};
const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open', TRIAGED: 'Triaged', IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked', RESOLVED: 'Resolved', CLOSED: 'Closed', CANCELED: 'Canceled',
};
const SEVERITY_BADGE: Record<string, string> = {
    INFO: 'badge-neutral', LOW: 'badge-neutral', MEDIUM: 'badge-warning',
    HIGH: 'badge-danger', CRITICAL: 'badge-danger',
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

    const [task, setTask] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<Tab>('overview');

    // Status
    const [changingStatus, setChangingStatus] = useState(false);

    // Assignment
    const [assigneeInput, setAssigneeInput] = useState('');
    const [assigning, setAssigning] = useState(false);

    // Links
    const [links, setLinks] = useState<any[]>([]);
    const [linksLoading, setLinksLoading] = useState(false);
    const [showLinkForm, setShowLinkForm] = useState(false);
    const [linkEntityType, setLinkEntityType] = useState('CONTROL');
    const [linkEntityId, setLinkEntityId] = useState('');
    const [linkRelation, setLinkRelation] = useState('RELATES_TO');
    const [savingLink, setSavingLink] = useState(false);

    // Comments
    const [comments, setComments] = useState<any[]>([]);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentBody, setCommentBody] = useState('');
    const [savingComment, setSavingComment] = useState(false);

    // Activity
    const [activity, setActivity] = useState<any[]>([]);
    const [activityLoading, setActivityLoading] = useState(false);

    const canComment = role !== 'READER';

    const fetchTask = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/tasks/${taskId}`));
            if (!res.ok) throw new Error('Task not found');
            const data = await res.json();
            setTask(data);
            setAssigneeInput(data.assigneeUserId || '');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, taskId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchTask(); }, [fetchTask]);

    // Fetch links when tab opens
    useEffect(() => {
        if (tab !== 'links') return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLinksLoading(true);
        fetch(apiUrl(`/tasks/${taskId}/links`))
            .then(r => r.ok ? r.json() : [])
            .then(setLinks)
            .catch(() => { })
            .finally(() => setLinksLoading(false));
    }, [tab, apiUrl, taskId]);

    // Fetch comments when tab opens
    useEffect(() => {
        if (tab !== 'comments') return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCommentsLoading(true);
        fetch(apiUrl(`/tasks/${taskId}/comments`))
            .then(r => r.ok ? r.json() : [])
            .then(setComments)
            .catch(() => { })
            .finally(() => setCommentsLoading(false));
    }, [tab, apiUrl, taskId]);

    // Fetch activity when tab opens
    useEffect(() => {
        if (tab !== 'activity') return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActivityLoading(true);
        fetch(apiUrl(`/tasks/${taskId}/activity`))
            .then(r => r.ok ? r.json() : [])
            .then(setActivity)
            .catch(() => { })
            .finally(() => setActivityLoading(false));
    }, [tab, apiUrl, taskId]);

    const changeStatus = async (status: string) => {
        setChangingStatus(true);
        await fetch(apiUrl(`/tasks/${taskId}/status`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        await fetchTask();
        setChangingStatus(false);
    };

    const handleAssign = async () => {
        setAssigning(true);
        await fetch(apiUrl(`/tasks/${taskId}/assign`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigneeUserId: assigneeInput || null }),
        });
        await fetchTask();
        setAssigning(false);
    };

    const addLink = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!linkEntityId.trim()) return;
        setSavingLink(true);
        await fetch(apiUrl(`/tasks/${taskId}/links`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entityType: linkEntityType, entityId: linkEntityId, relation: linkRelation }),
        });
        setLinkEntityId('');
        setShowLinkForm(false);
        // Refresh links
        const res = await fetch(apiUrl(`/tasks/${taskId}/links`));
        if (res.ok) setLinks(await res.json());
        setSavingLink(false);
    };

    // Epic 67 — delayed-commit link removal. Optimistic local filter so
    // the row disappears immediately. On undo we refetch to restore;
    // on commit success we leave the local state alone (already correct).
    const removeLink = (linkId: string) => {
        const previous = links;
        setLinks(prev => prev.filter(l => l.id !== linkId));
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
            undoAction: () => setLinks(previous),
            onError: () => setLinks(previous),
        });
    };

    const addComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!commentBody.trim()) return;
        setSavingComment(true);
        await fetch(apiUrl(`/tasks/${taskId}/comments`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: commentBody }),
        });
        setCommentBody('');
        // Refresh comments
        const res = await fetch(apiUrl(`/tasks/${taskId}/comments`));
        if (res.ok) setComments(await res.json());
        setSavingComment(false);
    };

    if (loading) return (
        <div className="space-y-6 animate-fadeIn" aria-busy="true">
            <div className="space-y-2">
                <SkeletonLine className="w-12" />
                <SkeletonLine className="w-64 h-7" />
                <div className="flex gap-2">
                    <SkeletonLine className="w-16 h-5 rounded-full" />
                    <SkeletonLine className="w-16 h-5 rounded-full" />
                    <SkeletonLine className="w-16 h-5 rounded-full" />
                </div>
            </div>
            <SkeletonCard lines={4} />
        </div>
    );
    if (error) return <div className="p-12 text-center text-content-error">{error}</div>;
    if (!task) return <div className="p-12 text-center text-content-subtle">Task not found.</div>;

    const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
        { key: 'overview', label: 'Overview', icon: <AppIcon name="overview" size={14} /> },
        { key: 'links', label: `Links${(task._count?.links ?? links.length) ? ` (${task._count?.links ?? links.length})` : ''}`, icon: <AppIcon name="link" size={14} /> },
        { key: 'comments', label: `Comments${(task._count?.comments ?? comments.length) ? ` (${task._count?.comments ?? comments.length})` : ''}`, icon: <AppIcon name="comments" size={14} /> },
        { key: 'activity', label: 'Activity', icon: <AppIcon name="activity" size={14} /> },
    ];

    const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && !(TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(task.status);
    const sla = getSlaStatus(task.severity, task.createdAt, task.status);
    const relevance = getRelevanceStatus(task, links);
    const metadata = task.metadataJson || {};

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <Link href={tenantHref('/tasks')} className="text-content-muted text-xs hover:text-content-emphasis transition">← Tasks</Link>
                    <h1 className="text-2xl font-bold mt-1" id="task-title">{task.title}</h1>
                    <div className="flex gap-2 mt-1 flex-wrap items-center">
                        {task.key && (
                            <CopyText
                                value={task.key}
                                label={`Copy task key ${task.key}`}
                                successMessage="Task key copied"
                                className="text-xs text-content-subtle"
                            >
                                {task.key}
                            </CopyText>
                        )}
                        <span className={`badge ${STATUS_BADGE[task.status] || 'badge-neutral'}`} id="task-status">
                            {STATUS_LABELS[task.status] || task.status}
                        </span>
                        <span className={`badge ${SEVERITY_BADGE[task.severity] || 'badge-neutral'}`} id="task-severity">
                            {task.severity}
                        </span>
                        <span className="badge badge-info text-xs">{TYPE_LABELS[task.type] || task.type}</span>
                        {isOverdue && <span className="badge badge-danger">Overdue</span>}
                        {sla.breach && <span className="badge badge-danger" id="sla-badge">{sla.label}</span>}
                        {relevance.satisfied ? (
                            <span className="badge badge-success text-xs" id="relevance-badge">Relevance satisfied</span>
                        ) : (
                            <span className="badge badge-warning text-xs" id="relevance-badge">{relevance.message}</span>
                        )}
                    </div>
                </div>
                {permissions.canWrite && (
                    <div className="flex gap-2 items-center">
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
                    </div>
                )}
            </div>

            {/* Assignment controls */}
            {permissions.canWrite && (
                <div className="glass-card p-4">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-content-muted">Assignee:</span>
                        <span className="text-sm text-content-emphasis font-medium" id="task-assignee">
                            {task.assignee?.name || task.assigneeUserId || 'Unassigned'}
                        </span>
                        <div className="w-64">
                            <UserCombobox
                                id="task-assignee-input"
                                name="assigneeUserId"
                                tenantSlug={tenantSlug}
                                selectedId={assigneeInput || null}
                                onChange={(userId) =>
                                    setAssigneeInput(userId ?? '')
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

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border-default">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        className={`px-4 py-2 text-sm font-medium transition border-b-2 ${tab === t.key ? 'border-[var(--brand-default)] text-content-emphasis' : 'border-transparent text-content-muted hover:text-content-emphasis'}`}
                        onClick={() => setTab(t.key)}
                        id={`tab-${t.key}`}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            {/* Overview Tab */}
            {tab === 'overview' && (
                <div className="glass-card p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-6">
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
                            <h3 className="text-sm font-semibold text-content-default mb-3">Audit Details</h3>
                            <div className="grid grid-cols-2 gap-4">
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
                <div className="space-y-4">
                    {permissions.canWrite && (
                        <div className="flex justify-end">
                            <Button variant="primary" onClick={() => setShowLinkForm(!showLinkForm)} id="add-link-btn">
                                + Add Link
                            </Button>
                        </div>
                    )}
                    {showLinkForm && permissions.canWrite && (
                        <form onSubmit={addLink} className="glass-card p-4 space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                                <Combobox hideSearch id="link-entity-type" selected={ENTITY_TYPE_CB_OPTIONS.find(o => o.value === linkEntityType) ?? null} setSelected={(opt) => setLinkEntityType(opt?.value ?? linkEntityType)} options={ENTITY_TYPE_CB_OPTIONS} matchTriggerWidth />
                                <input type="text" className="input" placeholder="Entity ID *" value={linkEntityId} onChange={e => setLinkEntityId(e.target.value)} required id="link-entity-id" />
                                <Combobox hideSearch id="link-relation" selected={RELATION_CB_OPTIONS.find(o => o.value === linkRelation) ?? null} setSelected={(opt) => setLinkRelation(opt?.value ?? linkRelation)} options={RELATION_CB_OPTIONS} matchTriggerWidth />
                            </div>
                            <Button type="submit" variant="primary" disabled={savingLink} id="submit-link-btn">
                                {savingLink ? 'Linking...' : 'Add Link'}
                            </Button>
                        </form>
                    )}
                    <div className="glass-card overflow-hidden">
                        {linksLoading ? (
                            <div className="p-4 space-y-2">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <SkeletonLine key={i} className="w-full" />
                                ))}
                            </div>
                        ) : links.length === 0 ? (
                            <div className="p-8 text-center text-content-subtle text-sm">No links yet</div>
                        ) : (
                            <table className="data-table" id="links-list">
                                <thead>
                                    <tr><th>Type</th><th>Entity ID</th><th>Relation</th><th>Created</th>{permissions.canWrite && <th>Actions</th>}</tr>
                                </thead>
                                <tbody>
                                    {links.map((l: any) => (
                                        <tr key={l.id}>
                                            <td><span className="badge badge-info text-xs">{l.entityType}</span></td>
                                            <td className="text-sm text-content-default font-mono">{l.entityId}</td>
                                            <td className="text-xs text-content-muted">{l.relation?.replace(/_/g, ' ') || '—'}</td>
                                            <td className="text-xs text-content-muted">{formatDate(l.createdAt)}</td>
                                            {permissions.canWrite && (
                                                <td>
                                                    <button className="text-content-error text-xs hover:text-content-error" onClick={() => removeLink(l.id)}>
                                                        × Remove
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* Comments Tab */}
            {tab === 'comments' && (
                <div className="space-y-4">
                    {canComment && (
                        <form onSubmit={addComment} className="glass-card p-4 space-y-3">
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
                                {savingComment ? 'Posting...' : 'Add Comment'}
                            </Button>
                        </form>
                    )}
                    <div className="glass-card overflow-hidden" id="comments-list">
                        {commentsLoading ? (
                            <div className="p-4 space-y-3">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="space-y-1">
                                        <SkeletonLine className="w-32" />
                                        <SkeletonLine className="w-full" />
                                    </div>
                                ))}
                            </div>
                        ) : comments.length === 0 ? (
                            <div className="p-8 text-center text-content-subtle text-sm">No comments yet</div>
                        ) : (
                            <div className="divide-y divide-border-default/50">
                                {comments.map((c: any) => (
                                    <div key={c.id} className="px-5 py-3">
                                        <div className="flex items-center gap-2 mb-1">
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
                <div className="glass-card overflow-hidden" id="activity-list">
                    {activityLoading ? (
                        <div className="p-4 space-y-3">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex items-start gap-3">
                                    <div className="animate-pulse rounded-full bg-bg-elevated/60 w-2 h-2 mt-2" />
                                    <div className="flex-1 space-y-1">
                                        <SkeletonLine className="w-48" />
                                        <SkeletonLine className="w-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : activity.length === 0 ? (
                        <div className="p-8 text-center text-content-subtle text-sm">No activity yet</div>
                    ) : (
                        <div className="divide-y divide-border-default/50">
                            {activity.map((evt: any) => (
                                <div key={evt.id} className="px-5 py-3 flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-[var(--brand-default)] mt-2 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-sm font-medium text-content-emphasis">{evt.user?.name || 'System'}</span>
                                            <span className="badge badge-neutral text-xs">{evt.action?.replace(/_/g, ' ')}</span>
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
        </div>
    );
}
