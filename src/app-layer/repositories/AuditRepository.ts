import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';
import { Prisma, ChecklistResult } from '@prisma/client';

// PR-3 — tight SELECT shape for the Audits master/detail list. Master
// list renders id/title/status + the two _count badges; detail pane
// fetches the heavier shape via getById.
const auditListSelect = {
    id: true,
    title: true,
    status: true,
    _count: { select: { checklist: true, findings: true } },
} as const;

export class AuditRepository {
    static async list(
        db: PrismaTx,
        ctx: RequestContext,
        options: { take?: number } = {},
    ) {
        return db.audit.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: { createdAt: 'desc' },
            select: auditListSelect,
            ...(options.take ? { take: options.take } : {}),
        });
    }

    static async getById(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.audit.findFirst({
            where: { id, tenantId: ctx.tenantId },
            include: {
                checklist: { orderBy: { sortOrder: 'asc' } },
                findings: { orderBy: { createdAt: 'desc' } },
            },
        });
    }

    static async create(db: PrismaTx, ctx: RequestContext, data: Omit<Prisma.AuditUncheckedCreateInput, 'tenantId'>) {
        return db.audit.create({
            data: {
                ...data,
                tenantId: ctx.tenantId,
            },
        });
    }

    static async update(db: PrismaTx, ctx: RequestContext, id: string, data: Omit<Prisma.AuditUncheckedUpdateInput, 'tenantId'>) {
        const existing = await this.getById(db, ctx, id);
        if (!existing) return null;

        return db.audit.update({
            where: { id },
            data,
        });
    }

    static async createChecklistItem(db: PrismaTx, ctx: RequestContext, auditId: string, prompt: string, sortOrder: number) {
        return db.auditChecklistItem.create({
            data: {
                tenantId: ctx.tenantId,
                auditId,
                prompt,
                sortOrder,
            },
        });
    }


    static async updateChecklistItem(db: PrismaTx, ctx: RequestContext, itemId: string, data: { result?: string | null; notes?: string | null }) {
        return db.auditChecklistItem.update({
            where: { id: itemId },
            data: {
                // `result` maps to the non-null ChecklistResult enum column —
                // a null/absent input means "leave unchanged".
                result: data.result == null ? undefined : (data.result as ChecklistResult),
                notes: data.notes,
            },
        });
    }
}
