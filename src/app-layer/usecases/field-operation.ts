import { RequestContext } from '../types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound, badRequest, forbidden } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import { createTask } from './task';
import { WorkItemRepository, TaskLinkRepository } from '../repositories/WorkItemRepository';
import { ParcelRepository } from '../repositories/ParcelRepository';
import { TERMINAL_WORK_ITEM_STATUSES } from '../domain/work-item-status';

type OperationType = 'SPRAY' | 'FERTILIZE' | 'SEED' | 'OTHER';
type ParcelStatus = 'PENDING' | 'DONE' | 'SKIPPED';

const TERMINAL_STATUSES: readonly string[] = TERMINAL_WORK_ITEM_STATUSES;

export interface CreateFieldOperationInput {
    title?: string;
    operationType?: OperationType;
    assigneeUserId: string;
    parcelIds: string[];
    productItemId: string;
    doseValue: number;
    doseUnitId: string;
    targetNote?: string | null;
    dueAt?: string | null;
}

function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Create a spray "job" over selected parcels of a Location:
 *   • one FIELD_OPERATION Task (assignee = operator) — created via
 *     `createTask`, so the assignment email + in-app bell come for free,
 *   • a Task→Location TaskLink (entityType LOCATION),
 *   • one OperationParcel prescription line per parcel (product + dose).
 *
 * The selection is validated BEFORE the task is created so a bad request
 * never leaves an orphan FIELD_OPERATION behind.
 */
export async function createFieldOperation(
    ctx: RequestContext,
    locationId: string,
    input: CreateFieldOperationInput,
) {
    assertCanWrite(ctx);

    // 1 — validate location, parcels, product and unit
    const location = await runInTenantContext(ctx, async (db) => {
        const loc = await db.location.findFirst({
            where: { id: locationId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true },
        });
        if (!loc) throw notFound('Location not found');

        const valid = await ParcelRepository.validIdsForLocation(db, ctx, locationId, input.parcelIds);
        const missing = input.parcelIds.filter((id) => !valid.has(id));
        if (missing.length) throw badRequest('Some selected parcels do not belong to this location.');

        const product = await db.item.findFirst({
            where: { id: input.productItemId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!product) throw badRequest('Product not found.');

        const unit = await db.unit.findUnique({ where: { id: input.doseUnitId }, select: { id: true } });
        if (!unit) throw badRequest('Dose unit not found.');

        return loc;
    });

    // 2 — create the FIELD_OPERATION Task (reuses createTask's assignment
    //     notification path: email + in-app bell)
    const opType: OperationType = input.operationType ?? 'SPRAY';
    const title = input.title?.trim() || `${titleCase(opType)} — ${location.name}`;
    const task = await createTask(ctx, {
        title,
        type: 'FIELD_OPERATION',
        assigneeUserId: input.assigneeUserId,
        dueAt: input.dueAt ?? null,
        description: input.targetNote ?? null,
    });

    // 3 — link Task→Location and write the per-parcel prescription lines
    const parcelCount = await runInTenantContext(ctx, async (db) => {
        await TaskLinkRepository.link(db, ctx, task.id, 'LOCATION', locationId);
        await db.operationParcel.createMany({
            data: input.parcelIds.map((parcelId) => ({
                tenantId: ctx.tenantId,
                taskId: task.id,
                parcelId,
                productItemId: input.productItemId,
                doseValue: input.doseValue,
                doseUnitId: input.doseUnitId,
                targetNote: input.targetNote ?? null,
            })),
        });

        await logEvent(db, ctx, {
            action: 'FIELD_OPERATION_CREATED',
            entityType: 'Task',
            entityId: task.id,
            details: `Created field operation ${task.key} over ${input.parcelIds.length} parcels`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Task',
                operation: 'created',
                after: {
                    operationType: opType,
                    locationId,
                    parcelCount: input.parcelIds.length,
                    assigneeUserId: input.assigneeUserId,
                },
                summary: `Created field operation ${task.key}`,
            },
        });

        return input.parcelIds.length;
    });

    return { taskId: task.id, taskKey: task.key, locationId, parcelCount };
}

/**
 * The operator's view of a spray job: the Task, its per-parcel lines
 * (with product + dose + parcel), the linked Location, and the parcel
 * geometry (GeoJSON) for the read-only map.
 */
export async function getFieldOperation(ctx: RequestContext, taskId: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const task = await db.task.findFirst({
            where: { id: taskId, tenantId: ctx.tenantId, type: 'FIELD_OPERATION' },
            include: { assignee: { select: { id: true, name: true, email: true } } },
        });
        if (!task) throw notFound('Field operation not found');

        const lines = await db.operationParcel.findMany({
            where: { taskId, tenantId: ctx.tenantId },
            include: {
                product: { select: { id: true, name: true } },
                doseUnit: { select: { id: true, symbol: true, name: true } },
                parcel: { select: { id: true, name: true, areaHa: true } },
                completedBy: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'asc' },
        });

        const link = await db.taskLink.findFirst({
            where: { taskId, tenantId: ctx.tenantId, entityType: 'LOCATION' },
            select: { entityId: true },
        });

        let location: { id: string; name: string; boundsJson: unknown } | null = null;
        let parcels: Awaited<ReturnType<typeof ParcelRepository.listForLocation>> = [];
        if (link) {
            location = await db.location.findFirst({
                where: { id: link.entityId, tenantId: ctx.tenantId },
                select: { id: true, name: true, boundsJson: true },
            });
            parcels = await ParcelRepository.listForLocation(db, ctx, link.entityId);
        }

        const total = lines.length;
        const done = lines.filter((l) => l.status === 'DONE' || l.status === 'SKIPPED').length;
        return { task, lines, location, parcels, progress: { total, done } };
    });
}

/**
 * Operator marks one prescription line DONE / SKIPPED (or back to
 * PENDING). The job auto-resolves (Task → RESOLVED) once no PENDING
 * lines remain. The assigned operator may act on their own job even
 * without general write permission.
 */
export async function markOperationParcel(
    ctx: RequestContext,
    taskId: string,
    lineId: string,
    status: ParcelStatus,
    note?: string | null,
) {
    return runInTenantContext(ctx, async (db) => {
        const line = await db.operationParcel.findFirst({
            where: { id: lineId, taskId, tenantId: ctx.tenantId },
            include: { task: { select: { id: true, assigneeUserId: true, status: true, key: true } } },
        });
        if (!line) throw notFound('Operation parcel not found');

        const isAssignee = line.task.assigneeUserId === ctx.userId;
        if (!ctx.permissions.canWrite && !isAssignee) {
            throw forbidden('You can only update field operations assigned to you.');
        }

        const fromStatus = line.status;
        await db.operationParcel.update({
            where: { id: lineId },
            data: {
                status,
                completedAt: status === 'PENDING' ? null : new Date(),
                completedByUserId: status === 'PENDING' ? null : ctx.userId,
                ...(note !== undefined ? { targetNote: note } : {}),
            },
        });

        await logEvent(db, ctx, {
            action: 'OPERATION_PARCEL_STATUS_CHANGED',
            entityType: 'OperationParcel',
            entityId: lineId,
            details: `Parcel prescription ${fromStatus} → ${status}`,
            detailsJson: {
                category: 'status_change',
                entityName: 'OperationParcel',
                fromStatus,
                toStatus: status,
            },
        });

        // Auto-resolve the job when no PENDING lines remain.
        let resolved = false;
        if (status !== 'PENDING' && !TERMINAL_STATUSES.includes(line.task.status)) {
            const pending = await db.operationParcel.count({
                where: { taskId, tenantId: ctx.tenantId, status: 'PENDING' },
            });
            if (pending === 0) {
                await WorkItemRepository.setStatus(db, ctx, taskId, 'RESOLVED', 'All parcels completed');
                await logEvent(db, ctx, {
                    action: 'TASK_STATUS_CHANGED',
                    entityType: 'Task',
                    entityId: taskId,
                    details: 'Field operation auto-resolved (all parcels completed)',
                    detailsJson: {
                        category: 'status_change',
                        entityName: 'Task',
                        fromStatus: line.task.status,
                        toStatus: 'RESOLVED',
                        reason: 'All parcels completed',
                    },
                });
                resolved = true;
            }
        }

        return { success: true, resolved };
    });
}

/**
 * List the FIELD_OPERATION jobs for a Location (its Operations tab),
 * resolved through the Task↔Location TaskLink.
 */
export async function listLocationOperations(ctx: RequestContext, locationId: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const links = await db.taskLink.findMany({
            where: { tenantId: ctx.tenantId, entityType: 'LOCATION', entityId: locationId },
            select: { taskId: true },
        });
        const taskIds = links.map((l) => l.taskId);
        if (taskIds.length === 0) return [];
        return db.task.findMany({
            where: { id: { in: taskIds }, tenantId: ctx.tenantId, type: 'FIELD_OPERATION' },
            include: {
                assignee: { select: { id: true, name: true, email: true } },
                _count: { select: { operationParcels: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    });
}
