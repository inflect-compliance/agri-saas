'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useState, useEffect } from 'react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TASK_STATUS_BADGE: Record<string, string> = {
    OPEN: 'badge-neutral', TRIAGED: 'badge-info', IN_PROGRESS: 'badge-info',
    BLOCKED: 'badge-danger', RESOLVED: 'badge-success', CLOSED: 'badge-neutral', CANCELED: 'badge-neutral',
};
const SEVERITY_BADGE: Record<string, string> = {
    CRITICAL: 'badge-danger', HIGH: 'badge-danger', MEDIUM: 'badge-warning', LOW: 'badge-info', INFO: 'badge-neutral',
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
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-elevated/30 transition text-sm"
                    id={`linked-task-${task.id}`}
                >
                    {task.key && <span className="font-mono text-xs text-content-subtle w-16 truncate">{task.key}</span>}
                    <span className="flex-1 text-white truncate">{task.title}</span>
                    <span className={`badge ${TASK_STATUS_BADGE[task.status] || 'badge-neutral'} text-xs`}>{task.status}</span>
                    {task.severity && (
                        <span className={`badge ${SEVERITY_BADGE[task.severity] || 'badge-neutral'} text-xs`}>{task.severity}</span>
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
