import { Prisma } from '@prisma/client';
import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';

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
    quantities?: LogQuantityInput[];
}

/**
 * Journal repository — LogEntry + its LogQuantity rows, tenant-scoped.
 * The journal is the field record; the spray-completion path writes one
 * INPUT_APPLICATION entry with the applied amount as a LogQuantity.
 */
export class JournalRepository {
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
            },
            select: { id: true, type: true, title: true, occurredAt: true },
        });
    }
}
