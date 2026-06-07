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
import { Tooltip } from '@/components/ui/tooltip';
import { User, Link2, AlertOctagon } from 'lucide-react';
import { TERMINAL_WORK_ITEM_STATUSES } from '@/app-layer/domain/work-item-status';
import {
    StatusBreakdown,
    type StatusBreakdownVariant,
} from '@/components/ui/status-breakdown';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { KPIStat } from '@/components/ui/metric';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SkeletonDashboard } from '@/components/ui/skeleton';
import { cardVariants } from '@/components/ui/card';

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
const TASK_STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'neutral', TRIAGED: 'info', IN_PROGRESS: 'info',
    BLOCKED: 'error', RESOLVED: 'success', CLOSED: 'neutral', CANCELED: 'neutral',
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
        return <SkeletonDashboard />;
    }

    const maxBar = Math.max(metrics.trend.created30d, metrics.trend.resolved30d, 1);

    return (
        <DashboardLayout
            header={{
                title: 'Task Dashboard',
                description: `${metrics.total} total tasks`,
                actions: (
                    <Tooltip content="Task register">
                        <Link href={tenantHref('/tasks')} aria-label="Task register" className={buttonVariants({ variant: 'secondary', size: 'icon' })}><AppIcon name="tasks" size={16} /></Link>
                    </Tooltip>
                ),
            }}
        >

            {/* KPI Cards — Polish PR-2: KPIStat primitive. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-default" id="dashboard-metrics">
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat value={metrics.total} label="Total Tasks" />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat
                        value={metrics.overdue}
                        label="Overdue"
                        tone={metrics.overdue > 0 ? 'critical' : 'default'}
                    />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat
                        value={metrics.dueIn7d}
                        label="Due in 7 days"
                        tone={metrics.dueIn7d > 0 ? 'attention' : 'default'}
                    />
                </div>
                <div className={cardVariants({ density: 'compact' })}>
                    <KPIStat value={metrics.dueIn30d} label="Due in 30 days" />
                </div>
            </div>

            {/* My Tasks */}
            <div className={cardVariants({ density: 'compact' })} id="my-tasks-section">
                <Heading level={3} className="mb-3"><User size={14} className="inline-block mr-1" /> My Tasks</Heading>
                {myTasks.length === 0 ? (
                    <p className="text-content-subtle text-sm text-center py-4">No open tasks assigned to you</p>
                ) : (
                    <div className="space-y-1">
                        {myTasks.map((task: any) => (
                            <Link
                                key={task.id}
                                href={tenantHref(`/tasks/${task.id}`)}
                                className="flex items-center gap-compact p-2 rounded-lg hover:bg-bg-muted/50 transition text-sm"
                            >
                                <span className="font-mono text-xs text-content-subtle w-16 truncate">{task.key}</span>
                                <span className="flex-1 text-content-emphasis truncate">{task.title}</span>
                                <StatusBadge variant={TASK_STATUS_BADGE[task.status] || 'neutral'}>{task.status}</StatusBadge>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-default">
                {/* By Status — Epic 59: StatusBreakdown primitive. */}
                <div className={cardVariants({ density: 'compact' })}>
                    <Heading level={3} className="mb-3">By Status</Heading>
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
                <div className={cardVariants({ density: 'compact' })}>
                    <Heading level={3} className="mb-3">By Severity</Heading>
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
                <div className={cardVariants({ density: 'compact' })}>
                    <Heading level={3} className="mb-3">30-Day Trend</Heading>
                    <div className="flex items-end gap-default h-24 mt-4">
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
            <div className={cardVariants({ density: 'compact' })}>
                <Heading level={3} className="mb-3">By Type</Heading>
                <div className="flex flex-wrap gap-compact">
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
                <div className={cardVariants({ density: 'compact' })} id="top-controls-section">
                    <Heading level={3} className="mb-3"><AppIcon name="controls" size={14} className="inline-block mr-1" /> Top Controls with Open Tasks</Heading>
                    <div className="space-y-tight">
                        {metrics.topControls.map((ctrl) => (
                            <Link
                                key={ctrl.controlId}
                                href={tenantHref(`/controls/${ctrl.controlId}`)}
                                className="flex items-center gap-compact p-2 rounded-lg hover:bg-bg-muted/50 transition text-sm"
                            >
                                <span className="font-mono text-xs text-content-subtle w-20 truncate">{ctrl.code}</span>
                                <span className="flex-1 text-content-emphasis truncate">{ctrl.name}</span>
                                <StatusBadge variant="warning">{ctrl.openTaskCount} open</StatusBadge>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Linked Entities (Assets/Risks) */}
            {metrics.topLinkedEntities && metrics.topLinkedEntities.length > 0 && (
                <div className={cardVariants({ density: 'compact' })} id="top-linked-entities-section">
                    <Heading level={3} className="mb-3"><Link2 size={14} className="inline-block mr-1" /> Top Assets & Risks with Open Tasks</Heading>
                    <div className="space-y-tight">
                        {metrics.topLinkedEntities.map((entity) => (
                            <div
                                key={`${entity.entityType}:${entity.entityId}`}
                                className="flex items-center gap-compact p-2 rounded-lg bg-bg-default/30 text-sm"
                            >
                                <StatusBadge variant={entity.entityType === 'ASSET' ? 'info' : 'warning'}>
                                    {entity.entityType}
                                </StatusBadge>
                                <span className="flex-1 text-content-default font-mono text-xs truncate">{entity.entityId}</span>
                                <StatusBadge variant="neutral">{entity.count} tasks</StatusBadge>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Overdue Tasks */}
            {overdueTasks.length > 0 && (
                <div className={cardVariants({ density: 'compact' })} id="overdue-tasks-section">
                    <Heading level={3} className="mb-3 text-content-error"><AlertOctagon size={14} className="inline-block mr-1" /> Overdue Tasks</Heading>
                    <div className="space-y-tight">
                        {overdueTasks.slice(0, 10).map((task: any) => (
                            <Link
                                key={task.id}
                                href={tenantHref(`/tasks/${task.id}`)}
                                className="flex items-center gap-compact p-2 rounded-lg hover:bg-bg-muted/50 transition text-sm"
                            >
                                <span className="font-mono text-xs text-content-subtle">{task.key}</span>
                                <span className="flex-1 text-content-emphasis truncate">{task.title}</span>
                                <StatusBadge variant="error">{task.severity}</StatusBadge>
                                <span className="text-xs text-content-error">
                                    Due {formatDate(task.dueAt)}
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
