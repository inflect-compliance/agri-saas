import { RequestContext } from '../types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound, badRequest, forbidden } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import { createTask } from './task';
import { WorkItemRepository, TaskLinkRepository } from '../repositories/WorkItemRepository';
import { ParcelRepository } from '../repositories/ParcelRepository';
import { TERMINAL_WORK_ITEM_STATUSES } from '../domain/work-item-status';
import { recordInputApplication, type InputApplicationResult } from './inventory';
import { attachAutoEvidenceFromLogEntry } from './auto-evidence';
import { traceAgUsecase } from '@/lib/observability';
import { trace } from '@opentelemetry/api';
import { emitAutomationEvent } from '../automation';

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
    /** Optional soil-nurturing fertilizer — an extra per-parcel line. */
    fertilizerItemId?: string | null;
    fertilizerDoseValue?: number | null;
    fertilizerDoseUnitId?: string | null;
    /** Optional per-decare water-carrier rate for the spray tank. */
    waterRateValue?: number | null;
    waterRateUnitId?: string | null;
    targetNote?: string | null;
    dueAt?: string | null;
}

function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** True when a complete (item + dose + unit) fertilizer was supplied. */
function hasFertilizer(
    input: CreateFieldOperationInput,
): input is CreateFieldOperationInput & {
    fertilizerItemId: string;
    fertilizerDoseValue: number;
    fertilizerDoseUnitId: string;
} {
    return (
        !!input.fertilizerItemId &&
        input.fertilizerDoseValue != null &&
        !!input.fertilizerDoseUnitId
    );
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

        // Optional soil-nurturing fertilizer: validate the same way when
        // supplied. It must be a DIFFERENT item from the treatment product
        // so the two per-parcel lines don't collide on the unique key.
        if (hasFertilizer(input)) {
            if (input.fertilizerItemId === input.productItemId) {
                throw badRequest('The fertilizer and the treatment product must be different items.');
            }
            const fert = await db.item.findFirst({
                where: { id: input.fertilizerItemId!, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!fert) throw badRequest('Fertilizer not found.');
            const fertUnit = await db.unit.findUnique({ where: { id: input.fertilizerDoseUnitId! }, select: { id: true } });
            if (!fertUnit) throw badRequest('Fertilizer dose unit not found.');
        }

        // Optional water-carrier rate: a rate value requires a unit, and the
        // unit must exist in the global catalog (like the dose unit above).
        if (input.waterRateValue != null) {
            if (!input.waterRateUnitId) throw badRequest('A water-rate unit is required when a water rate is set.');
            const waterUnit = await db.unit.findUnique({ where: { id: input.waterRateUnitId }, select: { id: true } });
            if (!waterUnit) throw badRequest('Water-rate unit not found.');
        }

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
        // One treatment line per parcel, plus a second fertilizer line per
        // parcel when a soil-nurturing fertilizer was chosen.
        const withFertilizer = hasFertilizer(input);
        await db.operationParcel.createMany({
            data: input.parcelIds.flatMap((parcelId) => {
                const lines = [
                    {
                        tenantId: ctx.tenantId,
                        taskId: task.id,
                        parcelId,
                        productItemId: input.productItemId,
                        doseValue: input.doseValue,
                        doseUnitId: input.doseUnitId,
                        // Water carrier lives on the treatment line only.
                        waterRateValue: input.waterRateValue ?? null,
                        waterRateUnitId: input.waterRateUnitId ?? null,
                        targetNote: input.targetNote ?? null,
                    },
                ];
                if (withFertilizer) {
                    lines.push({
                        tenantId: ctx.tenantId,
                        taskId: task.id,
                        parcelId,
                        productItemId: input.fertilizerItemId,
                        doseValue: input.fertilizerDoseValue,
                        doseUnitId: input.fertilizerDoseUnitId,
                        waterRateValue: null,
                        waterRateUnitId: null,
                        targetNote: input.targetNote ?? null,
                    });
                }
                return lines;
            }),
        });

        await logEvent(db, ctx, {
            action: 'SPRAY_JOB_STARTED',
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

    // Field-workflow automation trigger (Epic 60 bus) — fires AFTER the
    // tx commits so a rule never acts on a rolled-back job. Mirrors the
    // SPRAY_JOB_STARTED audit action one-to-one.
    await emitAutomationEvent(ctx, {
        event: 'SPRAY_JOB_STARTED',
        entityType: 'Task',
        entityId: task.id,
        actorUserId: ctx.userId,
        stableKey: task.id,
        data: {
            taskId: task.id,
            taskKey: task.key,
            locationId,
            operationType: opType,
            parcelCount,
            productItemId: input.productItemId,
            assigneeUserId: input.assigneeUserId,
        },
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
                waterRateUnit: { select: { id: true, symbol: true } },
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
    return traceAgUsecase('field-operation.markOperationParcel', ctx, () =>
        markOperationParcelImpl(ctx, taskId, lineId, status, note),
    );
}

async function markOperationParcelImpl(
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
            action: 'OPERATION_PARCEL_MARKED',
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

        trace.getActiveSpan()?.setAttributes({
            'ag.taskId': taskId,
            'ag.operationParcelId': lineId,
            'ag.parcelId': line.parcelId,
            'ag.status': status,
            'ag.doseValue': Number(line.doseValue),
        });

        // Phase 1 — completing a line (from a non-DONE state) makes it a
        // compliant, inventory-accurate spray record: emit the
        // INPUT_APPLICATION journal entry + the CONSUMPTION ledger entry
        // against the product's FEFO lot. Module-gated (JOURNAL /
        // INVENTORY) inside recordInputApplication; a no-op when both are
        // off, so this is backward-compatible with Feature 1. Un-completing
        // does NOT auto-reverse (the ledger is append-only — post an
        // ADJUSTMENT); re-completing re-emits a fresh application.
        let application: InputApplicationResult | null = null;
        if (status === 'DONE' && fromStatus !== 'DONE') {
            application = await recordInputApplication(db, ctx, {
                id: line.id,
                parcelId: line.parcelId,
                productItemId: line.productItemId,
                doseValue: line.doseValue,
                doseUnitId: line.doseUnitId,
            });

            // The spray record is itself the certification evidence for the
            // plant-protection / input-record control points. Attach it to
            // every scheme control the tenant has mapped — in the SAME
            // transaction as the journal write, so they commit atomically.
            // No-op when the tenant hasn't installed a scheme (no mapped
            // controls) or when JOURNAL is off (no journalEntryId).
            if (application?.journalEntryId) {
                await attachAutoEvidenceFromLogEntry(db, ctx, application.journalEntryId);
            }
        }

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

        trace.getActiveSpan()?.setAttribute('ag.jobResolved', resolved);

        // Field-workflow automation trigger (Epic 60 bus) — emitted at the
        // tail of the tenant tx, once `resolved` is known. Mirrors the
        // OPERATION_PARCEL_MARKED audit action.
        await emitAutomationEvent(ctx, {
            event: 'OPERATION_PARCEL_MARKED',
            entityType: 'OperationParcel',
            entityId: lineId,
            actorUserId: ctx.userId,
            stableKey: `${lineId}:${status}`,
            data: {
                taskId,
                operationParcelId: lineId,
                parcelId: line.parcelId,
                status,
                jobResolved: resolved,
            },
        });

        return { success: true, resolved, application };
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
