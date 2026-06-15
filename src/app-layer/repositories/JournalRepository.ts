import { Prisma, LogEntryType, LogEntryStatus } from '@prisma/client';
import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';
import { buildCursorWhere, CURSOR_ORDER_BY, computePageInfo, clampLimit } from '@/lib/pagination';
import type { PaginatedResponse } from '@/lib/dto/pagination';

export interface LogQuantityInput {
    measure:
        | 'COUNT'
        | 'WEIGHT'
        | 'VOLUME'
        | 'AREA'
        | 'LENGTH'
        | 'RATE'
        | 'OTHER';
    value: number;
    unitId: string;
    label?: string | null;
}

export interface CreateLogEntryInput {
    type:
        | 'ACTIVITY'
        | 'OBSERVATION'
        | 'INPUT_APPLICATION'
        | 'SEEDING'
        | 'TRANSPLANTING'
        | 'HARVEST'
        | 'IRRIGATION'
        | 'MAINTENANCE'
        | 'LAB_TEST'
        | 'GRAZING';
    title: string;
    occurredAt?: Date;
    status?: 'PLANNED' | 'DONE';
    notes?: string | null;
    conditionsJson?: Prisma.InputJsonValue;
    operationParcelId?: string | null;
    costAmount?: number | null;
    costCurrency?: string | null;
    quantities?: LogQuantityInput[];
    /** Feature-1 Location ids the entry happened at. */
    locationIds?: string[];
    /** Equipment ids used in the entry. */
    equipmentIds?: string[];
}

export interface UpdateLogEntryInput {
    type?: CreateLogEntryInput['type'];
    title?: string;
    occurredAt?: Date;
    status?: 'PLANNED' | 'DONE';
    notes?: string | null;
    operationParcelId?: string | null;
    costAmount?: number | null;
    costCurrency?: string | null;
    /** When provided, fully REPLACES the existing quantity set. */
    quantities?: LogQuantityInput[];
    /** When provided, fully REPLACES the existing location links. */
    locationIds?: string[];
    /** When provided, fully REPLACES the existing equipment links. */
    equipmentIds?: string[];
}

export interface LogEntryFilters {
    type?: string;
    status?: string;
    q?: string;
    /** ISO date — entries with occurredAt >= this. */
    occurredFrom?: string;
    /** ISO date — entries with occurredAt <= this. */
    occurredTo?: string;
}

export interface LogEntryListParams {
    limit?: number;
    cursor?: string;
    filters?: LogEntryFilters;
}

/**
 * Shared include shape for a fully-hydrated journal entry (sans
 * `files` — that link is added per-query in `getById` with an explicit
 * tenant filter, since FileRecord has no [id, tenantId] barrier).
 */
const ENTRY_DETAIL_INCLUDE = {
    quantities: { include: { unit: { select: { id: true, symbol: true, name: true } } } },
    locations: { include: { location: { select: { id: true, name: true } } } },
    equipment: { include: { equipment: { select: { id: true, name: true, category: true } } } },
} satisfies Prisma.LogEntryInclude;

/** Lightweight include shape for list rows (counts + first location label). */
const ENTRY_LIST_INCLUDE = {
    locations: { include: { location: { select: { id: true, name: true } } } },
    _count: { select: { quantities: true, files: true } },
} satisfies Prisma.LogEntryInclude;

/**
 * Journal repository — LogEntry + its LogQuantity / LogLocation /
 * LogEquipment / LogEntryFile rows, tenant-scoped.
 *
 * LogEntry is NOT registered with the Prisma soft-delete middleware
 * (`SOFT_DELETE_MODELS` in `src/lib/soft-delete.ts`), so this
 * repository handles the soft-delete trio EXPLICITLY: reads filter
 * `deletedAt: null`, `delete` stamps `deletedAt` instead of removing
 * the row, and `purge` is the only hard-delete path.
 */
export class JournalRepository {
    // ─── Reads ───────────────────────────────────────────────────────

    static async list(db: PrismaTx, ctx: RequestContext, filters?: LogEntryFilters) {
        const where = JournalRepository._buildWhere(ctx, filters);
        return db.logEntry.findMany({
            where,
            orderBy: { occurredAt: 'desc' },
            include: ENTRY_LIST_INCLUDE,
            take: 200,
        });
    }

    static async listPaginated(db: PrismaTx, ctx: RequestContext, params: LogEntryListParams): Promise<PaginatedResponse<unknown>> {
        const limit = clampLimit(params.limit);
        const where = JournalRepository._buildWhere(ctx, params.filters);

        const cursorWhere = buildCursorWhere(params.cursor);
        if (cursorWhere) {
            if (where.AND) {
                (where.AND as Prisma.LogEntryWhereInput[]).push(cursorWhere as Prisma.LogEntryWhereInput);
            } else {
                where.AND = [cursorWhere as Prisma.LogEntryWhereInput];
            }
        }

        const items = await db.logEntry.findMany({
            where,
            orderBy: CURSOR_ORDER_BY,
            take: limit + 1,
            include: ENTRY_LIST_INCLUDE,
        });

        const { trimmedItems, nextCursor, hasNextPage } = computePageInfo(items, limit);
        return { items: trimmedItems, pageInfo: { nextCursor, hasNextPage } };
    }

    private static _buildWhere(ctx: RequestContext, filters?: LogEntryFilters): Prisma.LogEntryWhereInput {
        const where: Prisma.LogEntryWhereInput = { tenantId: ctx.tenantId, deletedAt: null };

        if (filters?.type) where.type = filters.type as LogEntryType;
        if (filters?.status) where.status = filters.status as LogEntryStatus;
        if (filters?.occurredFrom || filters?.occurredTo) {
            where.occurredAt = {
                ...(filters.occurredFrom ? { gte: new Date(filters.occurredFrom) } : {}),
                ...(filters.occurredTo ? { lte: new Date(filters.occurredTo) } : {}),
            };
        }
        if (filters?.q) {
            where.OR = [
                { title: { contains: filters.q, mode: 'insensitive' } },
                { notes: { contains: filters.q, mode: 'insensitive' } },
            ];
        }

        return where;
    }

    static async getById(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.logEntry.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            include: {
                ...ENTRY_DETAIL_INCLUDE,
                files: {
                    where: { tenantId: ctx.tenantId },
                    include: { fileRecord: true },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
    }

    /** Find including soft-deleted rows — for restore / purge. */
    static async getByIdWithDeleted(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.logEntry.findFirst({
            where: { id, tenantId: ctx.tenantId },
            select: { id: true, tenantId: true, deletedAt: true, title: true },
        });
    }

    // ─── Validation helpers ──────────────────────────────────────────

    /** Returns the subset of the given location ids that belong to the tenant. */
    static async validLocationIds(db: PrismaTx, ctx: RequestContext, ids: string[]): Promise<Set<string>> {
        if (!ids.length) return new Set();
        // Bounded by the caller's id set (Create/UpdateLogEntry Zod caps
        // locationIds at 100) — `take` makes the bound explicit so the
        // unbounded-findMany guardrail stays satisfied.
        const rows = await db.location.findMany({
            where: { id: { in: ids }, tenantId: ctx.tenantId },
            select: { id: true },
            take: ids.length,
        });
        return new Set(rows.map((r) => r.id));
    }

    /** Returns the subset of the given equipment ids that belong to the tenant. */
    static async validEquipmentIds(db: PrismaTx, ctx: RequestContext, ids: string[]): Promise<Set<string>> {
        if (!ids.length) return new Set();
        // Bounded by the caller's id set (Create/UpdateLogEntry Zod caps
        // equipmentIds at 100) — `take` makes the bound explicit.
        const rows = await db.equipment.findMany({
            where: { id: { in: ids }, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
            take: ids.length,
        });
        return new Set(rows.map((r) => r.id));
    }

    /** Returns the subset of the given parcel ids that belong to the tenant. */
    static async validParcelIds(db: PrismaTx, ctx: RequestContext, ids: string[]): Promise<Set<string>> {
        if (!ids.length) return new Set();
        // Bounded by the caller's id set (farm-task Zod caps parcelIds at 100).
        const rows = await db.parcel.findMany({
            where: { id: { in: ids }, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
            take: ids.length,
        });
        return new Set(rows.map((r) => r.id));
    }

    /** List the tenant's active equipment (newest first) for pickers. */
    static async listEquipment(db: PrismaTx, ctx: RequestContext, take = 200) {
        return db.equipment.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true, category: true, make: true, model: true },
            orderBy: [{ createdAt: 'desc' }],
            take: take,
        });
    }

    // ─── Mutations ───────────────────────────────────────────────────

    static async createLogEntry(db: PrismaTx, ctx: RequestContext, input: CreateLogEntryInput) {
        return db.logEntry.create({
            data: {
                tenantId: ctx.tenantId,
                type: input.type,
                status: input.status ?? 'DONE',
                occurredAt: input.occurredAt ?? new Date(),
                title: input.title,
                notes: input.notes ?? null,
                ...(input.conditionsJson !== undefined ? { conditionsJson: input.conditionsJson } : {}),
                operationParcelId: input.operationParcelId ?? null,
                ...(input.costAmount != null ? { costAmount: input.costAmount } : {}),
                costCurrency: input.costCurrency ?? null,
                createdByUserId: ctx.userId ?? null,
                ...(input.quantities && input.quantities.length
                    ? {
                          quantities: {
                              // tenantId is populated by Prisma from the parent
                              // via the composite [logEntryId, tenantId] relation
                              // FK — passing it explicitly is rejected.
                              create: input.quantities.map((q) => ({
                                  measure: q.measure,
                                  value: q.value,
                                  unitId: q.unitId,
                                  label: q.label ?? null,
                              })),
                          },
                      }
                    : {}),
                ...(input.locationIds && input.locationIds.length
                    ? {
                          locations: {
                              create: input.locationIds.map((locationId) => ({
                                  tenantId: ctx.tenantId,
                                  locationId,
                              })),
                          },
                      }
                    : {}),
                ...(input.equipmentIds && input.equipmentIds.length
                    ? {
                          equipment: {
                              create: input.equipmentIds.map((equipmentId) => ({
                                  tenantId: ctx.tenantId,
                                  equipmentId,
                              })),
                          },
                      }
                    : {}),
            },
            include: {
                quantities: true,
                locations: true,
                equipment: true,
            },
        });
    }

    static async updateLogEntry(db: PrismaTx, ctx: RequestContext, id: string, input: UpdateLogEntryInput) {
        // Scalar fields. `undefined` leaves a field untouched; explicit
        // null clears the nullable columns.
        const data: Prisma.LogEntryUncheckedUpdateInput = {};
        if (input.type !== undefined) data.type = input.type;
        if (input.title !== undefined) data.title = input.title;
        if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;
        if (input.status !== undefined) data.status = input.status;
        if (input.notes !== undefined) data.notes = input.notes;
        if (input.operationParcelId !== undefined) data.operationParcelId = input.operationParcelId;
        if (input.costAmount !== undefined) data.costAmount = input.costAmount;
        if (input.costCurrency !== undefined) data.costCurrency = input.costCurrency;

        // Child-collection replaces — only when the caller supplied the
        // array. `deleteMany` then `create` gives full-replace semantics
        // in one transaction (the wrapping usecase runs inside one tx).
        if (input.quantities !== undefined) {
            data.quantities = {
                deleteMany: {},
                create: input.quantities.map((q) => ({
                    measure: q.measure,
                    value: q.value,
                    unitId: q.unitId,
                    label: q.label ?? null,
                })),
            };
        }
        if (input.locationIds !== undefined) {
            data.locations = {
                deleteMany: {},
                create: input.locationIds.map((locationId) => ({
                    tenantId: ctx.tenantId,
                    locationId,
                })),
            };
        }
        if (input.equipmentIds !== undefined) {
            data.equipment = {
                deleteMany: {},
                create: input.equipmentIds.map((equipmentId) => ({
                    tenantId: ctx.tenantId,
                    equipmentId,
                })),
            };
        }

        return db.logEntry.update({
            where: { id },
            data,
            include: {
                quantities: true,
                locations: true,
                equipment: true,
            },
        });
    }

    /** Soft-delete: stamp deletedAt + deletedByUserId. */
    static async softDelete(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.logEntry.update({
            where: { id },
            data: { deletedAt: new Date(), deletedByUserId: ctx.userId ?? null },
        });
    }

    /** Restore a soft-deleted entry. */
    static async restore(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.logEntry.update({
            where: { id },
            data: { deletedAt: null, deletedByUserId: null },
        });
    }

    /** Hard delete — cascades to LogQuantity / LogLocation / LogEquipment / LogEntryFile. */
    static async purge(db: PrismaTx, ctx: RequestContext, id: string) {
        await db.logEntry.delete({ where: { id } });
        return true;
    }

    // ─── File links (photo logging) ──────────────────────────────────

    static async attachFile(
        db: PrismaTx,
        ctx: RequestContext,
        logEntryId: string,
        fileRecordId: string,
        caption?: string | null,
    ) {
        return db.logEntryFile.create({
            data: {
                tenantId: ctx.tenantId,
                logEntryId,
                fileRecordId,
                caption: caption ?? null,
            },
            include: { fileRecord: true },
        });
    }

    static async getFileLink(db: PrismaTx, ctx: RequestContext, logEntryId: string, fileRecordId: string) {
        return db.logEntryFile.findFirst({
            where: { logEntryId, fileRecordId, tenantId: ctx.tenantId },
            select: { id: true },
        });
    }

    static async detachFile(db: PrismaTx, ctx: RequestContext, logEntryId: string, fileRecordId: string) {
        await db.logEntryFile.deleteMany({
            where: { logEntryId, fileRecordId, tenantId: ctx.tenantId },
        });
        return true;
    }
}
