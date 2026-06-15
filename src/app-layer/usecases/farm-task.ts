import { RequestContext } from '../types';
import { badRequest } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import { JournalRepository } from '../repositories/JournalRepository';
import { createTask, addTaskLink, listTasks } from './task';
import { getFarmTaskType } from '@/lib/agriculture/farm-task-types';

/**
 * Farm tasks — assignable field work tied to places/crops/equipment.
 *
 * This is a THIN orchestration over the IC Task module (reused unchanged):
 * a FARM_TASK is a `Task` whose LiteFarm-catalog type + category ride in
 * `metadataJson`, linked to Location/Parcel/Equipment via `TaskLink`, and
 * assigned through the same path that fires the TASK_ASSIGNED notification.
 * No change to `usecases/task.ts`, `TaskLink`, or the assignment pipeline.
 */

/** The two WorkItemTypes that make up an operator's farm queue. */
const FARM_TASK_TYPES_FILTER = ['FARM_TASK', 'FIELD_OPERATION'] as const;

export interface CreateFarmTaskInput {
    title: string;
    /** A key from the farm-task-type catalog (src/lib/agriculture). */
    farmTaskType: string;
    description?: string | null;
    priority?: string;
    dueAt?: string | null;
    assigneeUserId?: string | null;
    locationIds?: string[];
    parcelIds?: string[];
    equipmentIds?: string[];
}

function assertAllOwned(label: string, requested: string[], valid: Set<string>) {
    const missing = requested.filter((id) => !valid.has(id));
    if (missing.length) {
        throw badRequest('INVALID_LINK', `${label} not found or belongs to a different tenant: ${missing[0]}`);
    }
}

/**
 * Create a farm task. Link ownership is validated BEFORE the task is
 * created so a bad link never leaves an orphan task. Then the IC Task
 * module does the work: createTask (with the FARM_TASK discriminator +
 * catalog type in metadata + assignee → TASK_ASSIGNED) and addTaskLink
 * per place/equipment.
 */
export async function createFarmTask(ctx: RequestContext, input: CreateFarmTaskInput) {
    const typeDef = getFarmTaskType(input.farmTaskType);
    if (!typeDef) throw badRequest('INVALID_FARM_TASK_TYPE', `Unknown farm task type: ${input.farmTaskType}`);

    const locationIds = input.locationIds ?? [];
    const parcelIds = input.parcelIds ?? [];
    const equipmentIds = input.equipmentIds ?? [];

    // Validate every link target belongs to the tenant (no orphan on failure).
    await runInTenantContext(ctx, async (db) => {
        if (locationIds.length) {
            assertAllOwned('Location', locationIds, await JournalRepository.validLocationIds(db, ctx, locationIds));
        }
        if (parcelIds.length) {
            assertAllOwned('Parcel', parcelIds, await JournalRepository.validParcelIds(db, ctx, parcelIds));
        }
        if (equipmentIds.length) {
            assertAllOwned('Equipment', equipmentIds, await JournalRepository.validEquipmentIds(db, ctx, equipmentIds));
        }
    });

    const task = await createTask(ctx, {
        type: 'FARM_TASK',
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        metadataJson: { farmTaskType: typeDef.key, farmTaskCategory: typeDef.category },
    });

    // Reuse TaskLink via the Task module's addTaskLink (entityType is the
    // freshly-widened enum value).
    for (const id of locationIds) await addTaskLink(ctx, task.id, 'LOCATION', id);
    for (const id of parcelIds) await addTaskLink(ctx, task.id, 'PARCEL', id);
    for (const id of equipmentIds) await addTaskLink(ctx, task.id, 'EQUIPMENT', id);

    return task;
}

export interface FarmTaskQueueOptions {
    /** Defaults to the caller (the operator's own queue). */
    assigneeUserId?: string;
    status?: string;
}

/**
 * An operator's farm-work queue — FARM_TASK + FIELD_OPERATION assigned to
 * the user, soonest-due first. Reuses `listTasks` (one bounded call per
 * type) and merges; no new repository surface.
 */
export async function listMyFarmTasks(ctx: RequestContext, opts: FarmTaskQueueOptions = {}) {
    const assigneeUserId = opts.assigneeUserId ?? ctx.userId ?? undefined;

    const lists = await Promise.all(
        FARM_TASK_TYPES_FILTER.map((type) =>
            listTasks(ctx, { assigneeUserId, status: opts.status, type }, { take: 200 }),
        ),
    );
    const merged = lists.flat();

    // Soonest-due first; null dueAt sinks to the bottom; newest as tiebreak.
    merged.sort((a, b) => {
        const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        if (da !== db) return da - db;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return merged.slice(0, 200);
}
