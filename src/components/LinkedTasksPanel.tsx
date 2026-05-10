'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TASK_STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'neutral', TRIAGED: 'info', IN_PROGRESS: 'info',
    BLOCKED: 'error', RESOLVED: 'success', CLOSED: 'neutral', CANCELED: 'neutral',
};
const SEVERITY_BADGE: Record<string, StatusBadgeVariant> = {
    CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'info', INFO: 'neutral',
};

interface LinkedTasksPanelProps {
    apiBase: string;
    entityType: string;
    entityId: string;
    tenantHref: (path: string) => string;
}

export default function LinkedTasksPanel({ apiBase, entityType, entityId, tenantHref }: LinkedTasksPanelProps) {
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        // PR #158 changed `/tasks` to return `{ rows, truncated }` from
        // the prior raw-array shape. Accept both — older deploys still
        // emit arrays, and this is the only LinkedTasksPanel touch
        // point so a defensive read is cheaper than a coordinated
        // schema flip.
        fetch(`${apiBase}/tasks?linkedEntityType=${encodeURIComponent(entityType)}&linkedEntityId=${encodeURIComponent(entityId)}`)
            .then(r => r.ok ? r.json() : { rows: [] })
            .then((data: unknown) => {
                if (Array.isArray(data)) setTasks(data);
                else if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
                    setTasks((data as { rows: unknown[] }).rows);
                } else setTasks([]);
            })
            .catch(() => setTasks([]))
            .finally(() => setLoading(false));
    }, [apiBase, entityType, entityId]);

    if (loading) {
        return <div className="text-content-subtle text-sm animate-pulse py-4 text-center">Loading linked tasks…</div>;
    }

    if (tasks.length === 0) {
        return <p className="text-content-subtle text-sm text-center py-4">No linked tasks</p>;
    }

    return (
        <div className="space-y-1">
            {tasks.map((task: any) => (
                <Link
                    key={task.id}
                    href={tenantHref(`/tasks/${task.id}`)}
                    className="flex items-center gap-compact p-2 rounded-lg hover:bg-bg-muted/50 transition text-sm"
                    id={`linked-task-${task.id}`}
                >
                    {task.key && <span className="font-mono text-xs text-content-subtle w-16 truncate">{task.key}</span>}
                    <span className="flex-1 text-white truncate">{task.title}</span>
                    <StatusBadge variant={TASK_STATUS_BADGE[task.status] || 'neutral'}>{task.status}</StatusBadge>
                    {task.severity && (
                        <StatusBadge variant={SEVERITY_BADGE[task.severity] || 'neutral'}>{task.severity}</StatusBadge>
                    )}
                    {task.dueAt && (
                        <span className={`text-xs ${new Date(task.dueAt) < new Date() ? 'text-content-error' : 'text-content-muted'}`}>
                            {formatDate(task.dueAt)}
                        </span>
                    )}
                </Link>
            ))}
        </div>
    );
}
