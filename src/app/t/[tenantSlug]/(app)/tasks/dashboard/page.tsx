'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { AppIcon } from '@/components/icons/AppIcon';
import { User, Link2, AlertOctagon } from 'lucide-react';
import { TERMINAL_WORK_ITEM_STATUSES } from '@/app-layer/domain/work-item-status';
import {
    StatusBreakdown,
    type StatusBreakdownVariant,
} from '@/components/ui/status-breakdown';

const STATUS_LABELS: Record<string, string> = {
    OPEN: 'Open', TRIAGED: 'Triaged', IN_PROGRESS: 'In Progress',
    BLOCKED: 'Blocked', RESOLVED: 'Resolved', CLOSED: 'Closed', CANCELED: 'Canceled',
};
// Epic 59 — map task status + severity onto semantic StatusBreakdown
// variants. Drops the hand-tuned hex palette that the inline bars
// were using, in exchange for tokens that re-theme correctly under
// Epic 51's light-mode toggle.
const STATUS_VARIANT: Record<string, StatusBreakdownVariant> = {
    OPEN: 'neutral',
    TRIAGED: 'info',
    IN_PROGRESS: 'info',
    BLOCKED: 'error',
    RESOLVED: 'success',
    CLOSED: 'neutral',
    CANCELED: 'neutral',
};
const SEVERITY_LABELS: Record<string, string> = { INFO: 'Info', LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };
const SEVERITY_VARIANT: Record<string, StatusBreakdownVariant> = {
    INFO: 'neutral',
    LOW: 'info',
    MEDIUM: 'warning',
    HIGH: 'warning',
    CRITICAL: 'error',
};
// STATUS_COLORS / SEVERITY_COLORS deleted — the inline bars that used
// them migrated to <StatusBreakdown> + semantic variants above. The
// only remaining dot indicators in this file also moved through
// <StatusBreakdown>'s `showDot` prop, so the hex palette is no
// longer referenced anywhere.
const TYPE_LABELS: Record<string, string> = {
    AUDIT_FINDING: 'Audit Finding', CONTROL_GAP: 'Control Gap',
    INCIDENT: 'Incident', IMPROVEMENT: 'Improvement', TASK: 'Task',
};
const TASK_STATUS_BADGE: Record<string, string> = {
    OPEN: 'badge-neutral', TRIAGED: 'badge-info', IN_PROGRESS: 'badge-info',
    BLOCKED: 'badge-danger', RESOLVED: 'badge-success', CLOSED: 'badge-neutral', CANCELED: 'badge-neutral',
};

interface Metrics {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    overdue: number;
    dueIn7d: number;
    dueIn30d: number;
    trend: { created30d: number; resolved30d: number };
    topControls: { controlId: string; code: string; name: string; openTaskCount: number }[];
    topLinkedEntities: { entityType: string; entityId: string; count: number }[];
}

export default function TaskDashboardPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const [metrics, setMetrics] = useState<Metrics | null>(null);
    const [overdueTasks, setOverdueTasks] = useState<any[]>([]);
    const [myTasks, setMyTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const [mRes, tRes, myRes] = await Promise.all([
            fetch(apiUrl('/tasks/metrics')),
            fetch(apiUrl('/tasks?due=overdue')),
            fetch(apiUrl('/tasks?assigneeUserId=me')),
        ]);
        if (mRes.ok) setMetrics(await mRes.json());
        if (tRes.ok) setOverdueTasks(await tRes.json());
        if (myRes.ok) {
            const all = await myRes.json();
            // Show only open tasks assigned to current user
            setMyTasks(Array.isArray(all) ? all.filter((t: any) => !(TERMINAL_WORK_ITEM_STATUSES as readonly string[]).includes(t.status)).slice(0, 10) : []);
        }
        setLoading(false);
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading || !metrics) {
        return <div className="p-12 text-center text-content-subtle animate-pulse">Loading dashboard...</div>;
    }

    const maxBar = Math.max(metrics.trend.created30d, metrics.trend.resolved30d, 1);

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold"><AppIcon name="dashboard" className="inline-block mr-2 align-text-bottom" /> Task Dashboard</h1>
                    <p className="text-content-muted text-sm">{metrics.total} total tasks</p>
                </div>
                <Link href={tenantHref('/tasks')} className={buttonVariants({ variant: 'secondary' })}>← Task Register</Link>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="dashboard-metrics">
                <div className="glass-card p-4 text-center">
                    <div className="text-3xl font-bold text-content-emphasis">{metrics.total}</div>
                    <div className="text-xs text-content-muted mt-1">Total Tasks</div>
                </div>
                <div className="glass-card p-4 text-center border-border-error">
                    <div className="text-3xl font-bold text-content-error">{metrics.overdue}</div>
                    <div className="text-xs text-content-muted mt-1">Overdue</div>
                </div>
                <div className="glass-card p-4 text-center border-border-warning">
                    <div className="text-3xl font-bold text-content-warning">{metrics.dueIn7d}</div>
                    <div className="text-xs text-content-muted mt-1">Due in 7 days</div>
                </div>
                <div className="glass-card p-4 text-center border-border-info">
                    <div className="text-3xl font-bold text-content-info">{metrics.dueIn30d}</div>
                    <div className="text-xs text-content-muted mt-1">Due in 30 days</div>
                </div>
            </div>

            {/* My Tasks */}
            <div className="glass-card p-4" id="my-tasks-section">
                <h3 className="text-sm font-semibold mb-3 text-content-default"><User size={14} className="inline-block mr-1" /> My Tasks</h3>
                {myTasks.length === 0 ? (
                    <p className="text-content-subtle text-sm text-center py-4">No open tasks assigned to you</p>
                ) : (
                    <div className="space-y-1">
                        {myTasks.map((task: any) => (
                            <Link
                                key={task.id}
                                href={tenantHref(`/tasks/${task.id}`)}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-elevated/30 transition text-sm"
                            >
                                <span className="font-mono text-xs text-content-subtle w-16 truncate">{task.key}</span>
                                <span className="flex-1 text-content-emphasis truncate">{task.title}</span>
                                <span className={`badge ${TASK_STATUS_BADGE[task.status] || 'badge-neutral'} text-xs`}>{task.status}</span>
                                {task.dueAt && (
                                    <span className={`text-xs ${new Date(task.dueAt) < new Date() ? 'text-content-error' : 'text-content-muted'}`}>
                                        {formatDate(task.dueAt)}
                                    </span>
                                )}
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            {/* Breakdown + Trend */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* By Status — Epic 59: StatusBreakdown primitive. */}
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold mb-3 text-content-default">By Status</h3>
                    <StatusBreakdown
                        ariaLabel="Tasks by status"
                        total={metrics.total}
                        size="sm"
                        items={Object.entries(STATUS_LABELS).map(([key, label]) => ({
                            id: key,
                            label,
                            value: metrics.byStatus[key] || 0,
                            // These are hand-tuned task-status hex palette
                            // values, not semantic variants — pass through
                            // as a styled dot+bar via an inline style in
                            // the renderer below would reintroduce raw
                            // style={{}}; instead project them onto the
                            // nearest semantic variant.
                            variant: STATUS_VARIANT[key] ?? 'neutral',
                        }))}
                    />
                </div>

                {/* By Severity — Epic 59: StatusBreakdown primitive. */}
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold mb-3 text-content-default">By Severity</h3>
                    <StatusBreakdown
                        ariaLabel="Tasks by severity"
                        total={metrics.total}
                        size="sm"
                        items={Object.entries(SEVERITY_LABELS).map(([key, label]) => ({
                            id: key,
                            label,
                            value: metrics.bySeverity[key] || 0,
                            variant: SEVERITY_VARIANT[key] ?? 'neutral',
                        }))}
                    />
                </div>

                {/* 30-Day Trend */}
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold mb-3 text-content-default">30-Day Trend</h3>
                    <div className="flex items-end gap-4 h-24 mt-4">
                        <div className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full bg-bg-info rounded-t" style={{ height: `${(metrics.trend.created30d / maxBar) * 80}px` }}>
                                <div className="w-full h-full bg-bg-info rounded-t" />
                            </div>
                            <span className="text-xs text-content-muted">Created</span>
                            <span className="text-sm font-bold text-content-info">{metrics.trend.created30d}</span>
                        </div>
                        <div className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full bg-bg-success rounded-t" style={{ height: `${(metrics.trend.resolved30d / maxBar) * 80}px` }}>
                                <div className="w-full h-full bg-bg-success rounded-t" />
                            </div>
                            <span className="text-xs text-content-muted">Resolved</span>
                            <span className="text-sm font-bold text-content-success">{metrics.trend.resolved30d}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* By Type */}
            <div className="glass-card p-4">
                <h3 className="text-sm font-semibold mb-3 text-content-default">By Type</h3>
                <div className="flex flex-wrap gap-3">
                    {Object.entries(TYPE_LABELS).map(([key, label]) => (
                        <div key={key} className="px-3 py-2 rounded-lg bg-bg-default/50 border border-border-default/50 text-xs">
                            <span className="text-content-muted">{label}: </span>
                            <span className="font-bold text-content-emphasis">{metrics.byType[key] || 0}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Top Controls with Open Tasks */}
            {metrics.topControls && metrics.topControls.length > 0 && (
                <div className="glass-card p-4" id="top-controls-section">
                    <h3 className="text-sm font-semibold mb-3 text-content-default"><AppIcon name="controls" size={14} className="inline-block mr-1" /> Top Controls with Open Tasks</h3>
                    <div className="space-y-2">
                        {metrics.topControls.map((ctrl) => (
                            <Link
                                key={ctrl.controlId}
                                href={tenantHref(`/controls/${ctrl.controlId}`)}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-elevated/30 transition text-sm"
                            >
                                <span className="font-mono text-xs text-content-subtle w-20 truncate">{ctrl.code}</span>
                                <span className="flex-1 text-content-emphasis truncate">{ctrl.name}</span>
                                <span className="badge badge-warning text-xs">{ctrl.openTaskCount} open</span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Linked Entities (Assets/Risks) */}
            {metrics.topLinkedEntities && metrics.topLinkedEntities.length > 0 && (
                <div className="glass-card p-4" id="top-linked-entities-section">
                    <h3 className="text-sm font-semibold mb-3 text-content-default"><Link2 size={14} className="inline-block mr-1" /> Top Assets & Risks with Open Tasks</h3>
                    <div className="space-y-2">
                        {metrics.topLinkedEntities.map((entity) => (
                            <div
                                key={`${entity.entityType}:${entity.entityId}`}
                                className="flex items-center gap-3 p-2 rounded-lg bg-bg-default/30 text-sm"
                            >
                                <span className={`badge text-xs ${entity.entityType === 'ASSET' ? 'badge-info' : 'badge-warning'}`}>
                                    {entity.entityType}
                                </span>
                                <span className="flex-1 text-content-default font-mono text-xs truncate">{entity.entityId}</span>
                                <span className="badge badge-neutral text-xs">{entity.count} tasks</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Overdue Tasks */}
            {overdueTasks.length > 0 && (
                <div className="glass-card p-4" id="overdue-tasks-section">
                    <h3 className="text-sm font-semibold mb-3 text-content-error"><AlertOctagon size={14} className="inline-block mr-1" /> Overdue Tasks</h3>
                    <div className="space-y-2">
                        {overdueTasks.slice(0, 10).map((task: any) => (
                            <Link
                                key={task.id}
                                href={tenantHref(`/tasks/${task.id}`)}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-elevated/30 transition text-sm"
                            >
                                <span className="font-mono text-xs text-content-subtle">{task.key}</span>
                                <span className="flex-1 text-content-emphasis truncate">{task.title}</span>
                                <span className="badge badge-danger text-xs">{task.severity}</span>
                                <span className="text-xs text-content-error">
                                    Due {formatDate(task.dueAt)}
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
