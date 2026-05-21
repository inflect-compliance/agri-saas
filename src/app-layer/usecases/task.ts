import { RequestContext } from '../types';
import { WorkItemRepository, TaskLinkRepository, TaskCommentRepository, TaskWatcherRepository, TaskFilters, TaskListParams } from '../repositories/WorkItemRepository';
import { assertCanReadTasks, assertCanWriteTasks, assertCanCommentOnTasks } from '../policies/task.policies';
import { logEvent } from '../events/audit';
import { emitAutomationEvent } from '../automation';
import { enqueueEmail } from '../notifications/enqueue';
import { createTaskDueNotification } from '../notifications/task-due';
import { runInTenantContext } from '@/lib/db-context';
import { env } from '@/env';
import { notFound, badRequest } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { validateTaskMetadata } from '../schemas/json-columns.schemas';
import { logger } from '@/lib/observability/logger';
import { cachedListRead, bumpEntityCacheVersion } from '@/lib/cache/list-cache';
import type { PrismaTx } from '@/lib/db-context';

// ─── Type-Specific Validation ───

type TaskType = 'AUDIT_FINDING' | 'CONTROL_GAP' | 'INCIDENT' | 'IMPROVEMENT' | 'TASK';

/**
 * Validate type-specific relevance rules.
 * - AUDIT_FINDING / CONTROL_GAP: must have controlId OR a link to CONTROL/FRAMEWORK_REQUIREMENT
 * - INCIDENT: must have controlId OR a link to CONTROL/ASSET
 * - TASK / IMPROVEMENT: no additional requirement
 */
async function validateTypeRelevance(
    db: PrismaTx,
    ctx: RequestContext,
    taskId: string,
    type: TaskType,
    controlId: string | null | undefined,
) {
    if (type === 'TASK' || type === 'IMPROVEMENT') return;

    if (controlId) return; // controlId satisfies all type constraints

    // Check links
    const links = await TaskLinkRepository.listByTask(db, ctx, taskId);
    const linkEntityTypes = links.map(l => l.entityType);

    if (type === 'AUDIT_FINDING' || type === 'CONTROL_GAP') {
        if (!linkEntityTypes.includes('CONTROL') && !linkEntityTypes.includes('FRAMEWORK_REQUIREMENT')) {
            throw badRequest(
                `${type} tasks must have a controlId or a link to CONTROL or FRAMEWORK_REQUIREMENT.`
            );
        }
    }

    if (type === 'INCIDENT') {
        if (!linkEntityTypes.includes('CONTROL') && !linkEntityTypes.includes('ASSET')) {
            throw badRequest(
                'INCIDENT tasks must have a controlId or a link to CONTROL or ASSET.'
            );
        }
    }
}

// ─── List / Get ───

export async function listTasks(
    ctx: RequestContext,
    filters: TaskFilters = {},
    options: { take?: number } = {},
) {
    assertCanReadTasks(ctx);
    return cachedListRead({
        ctx,
        entity: 'task',
        operation: 'list',
        // `take` must be in the cache key — bounded and unbounded
        // results have different shapes; sharing a key would let a
        // bounded SSR fetch poison the unbounded API GET cache.
        params: options.take ? { ...filters, _take: options.take } : filters,
        loader: () =>
            runInTenantContext(ctx, (db) =>
                WorkItemRepository.list(db, ctx, filters, options),
            ),
    });
}

export async function listTasksPaginated(ctx: RequestContext, params: TaskListParams) {
    assertCanReadTasks(ctx);
    return cachedListRead({
        ctx,
        entity: 'task',
        operation: 'listPaginated',
        params,
        loader: () =>
            runInTenantContext(ctx, (db) =>
                WorkItemRepository.listPaginated(db, ctx, params),
            ),
    });
}

export async function getTask(ctx: RequestContext, taskId: string) {
    assertCanReadTasks(ctx);
    return runInTenantContext(ctx, async (db) => {
        const task = await WorkItemRepository.getById(db, ctx, taskId);
        if (!task) throw notFound('Task not found');
        return task;
    });
}

// ─── Create ───

export async function createTask(ctx: RequestContext, input: {
    title: string;
    type?: string;
    description?: string | null;
    severity?: string;
    priority?: string;
    source?: string;
    dueAt?: string | null;
    assigneeUserId?: string | null;
    reviewerUserId?: string | null;
    controlId?: string | null;
    metadataJson?: unknown;
}) {
    assertCanWriteTasks(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        // Validate metadataJson on write
        if (input.metadataJson !== undefined) {
            input.metadataJson = validateTaskMetadata(input.metadataJson);
        }
        const task = await WorkItemRepository.create(db, ctx, input);

        // Type-specific validation (deferred: allow creation, then check after links can be added)
        // For create, we validate immediately since controlId is already set
        const type = (input.type || 'TASK') as TaskType;
        if (type !== 'TASK' && type !== 'IMPROVEMENT') {
            // Only validate if controlId is required and not provided
            // Links can't exist yet at creation time, so we only enforce controlId here
            if (!input.controlId && (type === 'AUDIT_FINDING' || type === 'CONTROL_GAP' || type === 'INCIDENT')) {
                // Don't fail — allow creation; validation happens on status transitions
                // Store a warning in metadataJson
            }
        }

        await logEvent(db, ctx, {
            action: 'TASK_CREATED',
            entityType: 'Task',
            entityId: task.id,
            details: `Created task ${task.key}: ${task.title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Task', operation: 'created', summary: 'TASK_CREATED' },
            metadata: { type: input.type, severity: input.severity, priority: input.priority },
        });

        await emitAutomationEvent(ctx, {
            event: 'TASK_CREATED',
            entityType: 'Task',
            entityId: task.id,
            actorUserId: ctx.userId,
            stableKey: task.id,
            data: {
                key: task.key,
                title: task.title,
                type: task.type,
                severity: task.severity,
                priority: task.priority,
                assigneeUserId: task.assigneeUserId,
                controlId: task.controlId,
            },
        });

        // Enqueue email to assignee if set
        if (input.assigneeUserId) {
            await enqueueTaskAssignedNotification(db, ctx, task.id, task.title, task.key, input.type || 'TASK', input.assigneeUserId);
        }

        return task;
    });
    // In-app TASK_DUE notification if the new task is already assigned
    // and due within a reminder window. Runs AFTER the task
    // transaction commits — see `emitTaskDueNotification`.
    await emitTaskDueNotification(ctx, result);
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

// ─── Update ───

export async function updateTask(ctx: RequestContext, taskId: string, patch: {
    title?: string;
    description?: string | null;
    severity?: string;
    priority?: string;
    dueAt?: string | null;
    controlId?: string | null;
    reviewerUserId?: string | null;
    metadataJson?: unknown;
}) {
    assertCanWriteTasks(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        // Validate metadataJson on write
        if (patch.metadataJson !== undefined) {
            patch.metadataJson = validateTaskMetadata(patch.metadataJson);
        }
        const task = await WorkItemRepository.update(db, ctx, taskId, patch);
        if (!task) throw notFound('Task not found');
        await logEvent(db, ctx, {
            action: 'TASK_UPDATED',
            entityType: 'Task',
            entityId: taskId,
            details: 'Updated task fields',
            detailsJson: { category: 'entity_lifecycle', entityName: 'Task', operation: 'updated', summary: 'TASK_UPDATED' },
            metadata: patch,
        });
        return task;
    });
    // A rescheduled `dueAt` may move the task into a reminder window —
    // re-evaluate the in-app notification after the commit.
    await emitTaskDueNotification(ctx, result);
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

// ─── Status ───

export async function setTaskStatus(ctx: RequestContext, taskId: string, status: string, resolution?: string | null) {
    assertCanWriteTasks(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        // Pre-fetch once so we can both validate + capture fromStatus
        // for the automation event.
        const existing = await WorkItemRepository.getById(db, ctx, taskId);
        if (!existing) throw notFound('Task not found');
        const fromStatus = existing.status;

        if (['RESOLVED', 'CLOSED'].includes(status)) {
            await validateTypeRelevance(db, ctx, taskId, existing.type as TaskType, existing.controlId);
        }

        const task = await WorkItemRepository.setStatus(db, ctx, taskId, status, resolution);
        if (!task) throw notFound('Task not found');
        await logEvent(db, ctx, {
            action: 'TASK_STATUS_CHANGED',
            entityType: 'Task',
            entityId: taskId,
            details: `Status changed to ${status}`,
            detailsJson: { category: 'status_change', entityName: 'Task', fromStatus: null, toStatus: 'TASK_STATUS_CHANGED' },
            metadata: { status, resolution },
        });
        await emitAutomationEvent(ctx, {
            event: 'TASK_STATUS_CHANGED',
            entityType: 'Task',
            entityId: taskId,
            actorUserId: ctx.userId,
            stableKey: `${taskId}:${fromStatus}:${status}`,
            data: {
                fromStatus,
                toStatus: status,
                resolution: resolution ?? null,
            },
        });
        return task;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

// ─── Assign ───

export async function assignTask(ctx: RequestContext, taskId: string, assigneeUserId: string | null) {
    assertCanWriteTasks(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const task = await WorkItemRepository.assign(db, ctx, taskId, assigneeUserId);
        if (!task) throw notFound('Task not found');
        await logEvent(db, ctx, {
            action: 'TASK_ASSIGNED',
            entityType: 'Task',
            entityId: taskId,
            details: assigneeUserId ? `Assigned to ${assigneeUserId}` : 'Unassigned',
            detailsJson: { category: 'custom', event: 'task_assigned' },
            metadata: { assigneeUserId },
        });

        // Enqueue email to new assignee
        if (assigneeUserId) {
            await enqueueTaskAssignedNotification(db, ctx, taskId, task.title, task.key, task.type, assigneeUserId);
        }
        return task;
    });
    // In-app TASK_DUE notification for the new assignee if the task
    // is due within a reminder window — after the commit.
    await emitTaskDueNotification(ctx, result);
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

/** Look up assignee email and enqueue TASK_ASSIGNED notification */
async function enqueueTaskAssignedNotification(
    db: PrismaTx,
    ctx: RequestContext,
    taskId: string,
    taskTitle: string,
    taskKey: string | null | undefined,
    taskType: string,
    assigneeUserId: string,
): Promise<void> {
    try {
        const assignee = await db.user.findUnique({
            where: { id: assigneeUserId },
            select: { email: true, name: true },
        });
        if (!assignee?.email) return;

        const assigner = await db.user.findUnique({
            where: { id: ctx.userId },
            select: { name: true },
        });

        await enqueueEmail(db, {
            tenantId: ctx.tenantId,
            type: 'TASK_ASSIGNED',
            toEmail: assignee.email,
            entityId: taskId,
            requestId: ctx.requestId,
            payload: {
                taskTitle,
                taskKey,
                taskType,
                assigneeName: assignee.name || assignee.email,
                assignerName: assigner?.name || undefined,
                tenantSlug: ctx.tenantSlug || '',
            },
        });
    } catch (err) {
        // Fire-and-forget — never break the task operation
        logger.warn('failed to enqueue task assignment email', { component: 'notifications' });
    }
}

/**
 * Fire the in-app `TASK_DUE` notification the moment a task is
 * created / rescheduled / assigned, so a near-term deadline reaches
 * the notification bell immediately — instead of waiting on the
 * daily 08:00 `task-due-notification` cron (which also depends on
 * the scheduler having registered the repeatable).
 *
 * Runs AFTER the task's own transaction has committed, in its own
 * short `runInTenantContext` transaction. It must NOT share the
 * caller's transaction:
 *   - A notification write must never roll back the task write — the
 *     task is the user's intent; the notification is a side effect.
 *   - `createTaskDueNotification` is idempotent via `ON CONFLICT DO
 *     NOTHING` (it shares the cron's `dedupeKey`), but isolating it
 *     in its own transaction also keeps any genuine DB error off the
 *     task transaction entirely.
 * Fully fire-and-forget — any failure is logged and swallowed.
 */
async function emitTaskDueNotification(
    ctx: RequestContext,
    task: {
        id: string;
        tenantId: string;
        title: string;
        key: string | null;
        dueAt: Date | null;
        assigneeUserId: string | null;
    },
): Promise<void> {
    if (!task.assigneeUserId || !task.dueAt || !ctx.tenantSlug) return;
    // Hoist the narrowed values — the closure below would otherwise
    // see the wider nullable property types.
    const tenantSlug = ctx.tenantSlug;
    const assigneeUserId = task.assigneeUserId;
    const dueAt = task.dueAt;
    try {
        await runInTenantContext(ctx, (db) =>
            createTaskDueNotification(
                db,
                {
                    id: task.id,
                    tenantId: task.tenantId,
                    tenantSlug,
                    title: task.title,
                    key: task.key,
                    dueAt,
                    assigneeUserId,
                },
                new Date(),
                // Classify in the same zone as the daily cron so the
                // event-driven and steady-state paths agree on the
                // window + dedupeKey for a task due near local midnight.
                env.NOTIFICATIONS_TZ,
            ),
        );
    } catch (err) {
        logger.warn('failed to create task-due notification', {
            component: 'notifications',
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── Links ───

export async function listTaskLinks(ctx: RequestContext, taskId: string) {
    assertCanReadTasks(ctx);
    return runInTenantContext(ctx, (db) => TaskLinkRepository.listByTask(db, ctx, taskId));
}

export async function addTaskLink(ctx: RequestContext, taskId: string, entityType: string, entityId: string, relation?: string) {
    assertCanWriteTasks(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const link = await TaskLinkRepository.link(db, ctx, taskId, entityType, entityId, relation);
        await logEvent(db, ctx, {
            action: 'TASK_LINKED',
            entityType: 'Task',
            entityId: taskId,
            details: `Linked to ${entityType} ${entityId}`,
            detailsJson: { category: 'relationship', operation: 'linked', sourceEntity: 'Task' },
            metadata: { entityType, entityId, relation },
        });
        return link;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

export async function removeTaskLink(ctx: RequestContext, linkId: string) {
    assertCanWriteTasks(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const result = await TaskLinkRepository.unlink(db, ctx, linkId);
        if (!result) throw notFound('Task link not found');
        await logEvent(db, ctx, {
            action: 'TASK_UNLINKED',
            entityType: 'Task',
            entityId: linkId,
            details: 'Removed task link',
            detailsJson: { category: 'relationship', operation: 'unlinked', sourceEntity: 'Task' },
        });
        return result;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return outcome;
}

// ─── Comments ───

export async function listTaskComments(ctx: RequestContext, taskId: string) {
    assertCanReadTasks(ctx);
    return runInTenantContext(ctx, (db) => TaskCommentRepository.listByTask(db, ctx, taskId));
}

export async function addTaskComment(ctx: RequestContext, taskId: string, body: string) {
    assertCanCommentOnTasks(ctx);
    // Epic C.5 — comments today are plain text. Strip any HTML the
    // client tries to inject before persistence so a future renderer
    // change (Markdown, HTML preview) can never accidentally re-enable
    // a stored XSS vector.
    const safeBody = sanitizePlainText(body);
    const result = await runInTenantContext(ctx, async (db) => {
        const comment = await TaskCommentRepository.add(db, ctx, taskId, safeBody);
        await logEvent(db, ctx, {
            action: 'TASK_COMMENT_ADDED',
            entityType: 'Task',
            entityId: taskId,
            details: 'Comment added',
            detailsJson: { category: 'custom', event: 'task_comment_added' },
            metadata: { commentId: comment.id },
        });
        return comment;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

// ─── Watchers ───

export async function listTaskWatchers(ctx: RequestContext, taskId: string) {
    assertCanReadTasks(ctx);
    return runInTenantContext(ctx, (db) => TaskWatcherRepository.listByTask(db, ctx, taskId));
}

export async function addTaskWatcher(ctx: RequestContext, taskId: string, userId: string) {
    assertCanWriteTasks(ctx);
    const result = await runInTenantContext(ctx, (db) => TaskWatcherRepository.add(db, ctx, taskId, userId));
    await bumpEntityCacheVersion(ctx, 'task');
    return result;
}

export async function removeTaskWatcher(ctx: RequestContext, taskId: string, userId: string) {
    assertCanWriteTasks(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const result = await TaskWatcherRepository.remove(db, ctx, taskId, userId);
        if (!result) throw notFound('Watcher not found');
        return result;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return outcome;
}

// ─── Metrics ───

export async function getTaskMetrics(ctx: RequestContext) {
    assertCanReadTasks(ctx);
    return runInTenantContext(ctx, (db) => WorkItemRepository.metrics(db, ctx));
}

// ─── Activity Feed ───

export async function getTaskActivity(ctx: RequestContext, taskId: string) {
    assertCanReadTasks(ctx);
    return runInTenantContext(ctx, (db) =>
        db.auditLog.findMany({
            where: { tenantId: ctx.tenantId, entity: 'Task', entityId: taskId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { user: { select: { id: true, name: true, email: true } } },
        })
    );
}

// ─── Bulk Actions ───

export async function bulkAssignTasks(ctx: RequestContext, taskIds: string[], assigneeUserId: string | null) {
    assertCanWriteTasks(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const result = await WorkItemRepository.bulkAssign(db, ctx, taskIds, assigneeUserId);
        for (const id of taskIds) {
            await logEvent(db, ctx, {
                action: 'TASK_ASSIGNED',
                entityType: 'Task',
                entityId: id,
                details: assigneeUserId ? `Bulk assigned to ${assigneeUserId}` : 'Bulk unassigned',
                detailsJson: { category: 'custom', event: 'task_assigned' },
                metadata: { assigneeUserId, bulk: true },
            });
        }
        return result;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return outcome;
}

export async function bulkSetTaskStatus(ctx: RequestContext, taskIds: string[], status: string, resolution?: string) {
    assertCanWriteTasks(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const result = await WorkItemRepository.bulkSetStatus(db, ctx, taskIds, status, resolution);
        for (const id of taskIds) {
            await logEvent(db, ctx, {
                action: 'TASK_STATUS_CHANGED',
                entityType: 'Task',
                entityId: id,
                details: `Bulk status changed to ${status}`,
                detailsJson: { category: 'status_change', entityName: 'Task', fromStatus: null, toStatus: 'TASK_STATUS_CHANGED' },
                metadata: { status, resolution, bulk: true },
            });
        }
        return result;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return outcome;
}

export async function bulkSetTaskDueDate(ctx: RequestContext, taskIds: string[], dueAt: string | null) {
    assertCanWriteTasks(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const result = await WorkItemRepository.bulkSetDueDate(db, ctx, taskIds, dueAt);
        for (const id of taskIds) {
            await logEvent(db, ctx, {
                action: 'TASK_UPDATED',
                entityType: 'Task',
                entityId: id,
                details: `Bulk due date set to ${dueAt || 'none'}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Task', operation: 'updated', summary: 'TASK_UPDATED' },
                metadata: { dueAt, bulk: true },
            });
        }
        return result;
    });
    await bumpEntityCacheVersion(ctx, 'task');
    return outcome;
}

// ─── By Control ───

export async function listTasksByControl(ctx: RequestContext, controlId: string) {
    assertCanReadTasks(ctx);
    return cachedListRead({
        ctx,
        entity: 'task',
        operation: 'listByControl',
        params: { controlId },
        loader: () =>
            runInTenantContext(ctx, (db) =>
                WorkItemRepository.list(db, ctx, { controlId }),
            ),
    });
}
