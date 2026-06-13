import { Prisma } from '@prisma/client';
import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';

/**
 * InventoryLot repository — all reads/writes tenant-scoped. The ledger
 * itself (StockTransaction) is written ONLY through
 * `src/lib/inventory/stock-ledger.ts`; this repository owns the lot
 * rows + read projections, never a direct StockTransaction write.
 */
export class InventoryRepository {
    /** List a tenant's lots (newest first), with item + unit for display. */
    static async listLots(
        db: PrismaTx,
        ctx: RequestContext,
        opts: { itemId?: string; take?: number } = {},
    ) {
        return db.inventoryLot.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                ...(opts.itemId ? { itemId: opts.itemId } : {}),
            },
            include: {
                item: { select: { id: true, name: true, category: true, reorderLevel: true } },
                unit: { select: { id: true, symbol: true, name: true } },
                location: { select: { id: true, name: true } },
            },
            orderBy: [{ createdAt: 'desc' }],
            take: opts.take ?? 200,
        });
    }

    /** A single lot with its recent ledger (most-recent first). */
    static async getLot(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.inventoryLot.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            include: {
                item: { select: { id: true, name: true, category: true } },
                unit: { select: { id: true, symbol: true, name: true } },
                location: { select: { id: true, name: true } },
            },
        });
    }

    /** The ledger rows for one lot (read projection, bounded). */
    static async lotLedger(db: PrismaTx, ctx: RequestContext, lotId: string, take = 100) {
        return db.stockTransaction.findMany({
            where: { tenantId: ctx.tenantId, lotId },
            include: {
                unit: { select: { symbol: true } },
                actor: { select: { id: true, name: true } },
            },
            orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
            take: take,
        });
    }

    /** Validate + fetch an item the lot/consumption will reference. */
    static async getItem(db: PrismaTx, ctx: RequestContext, itemId: string) {
        return db.item.findFirst({
            where: { id: itemId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true, defaultUnitId: true, reorderLevel: true },
        });
    }

    /** Create a lot row (stock is added separately via a RECEIPT ledger entry). */
    static async createLot(
        db: PrismaTx,
        ctx: RequestContext,
        input: {
            itemId: string;
            lotCode: string;
            unitId: string;
            locationId?: string | null;
            expiresAt?: Date | null;
            receivedAt?: Date | null;
            unitCostAmount?: number | null;
            unitCostCurrency?: string | null;
            attributesJson?: Prisma.InputJsonValue;
        },
    ) {
        return db.inventoryLot.create({
            data: {
                tenantId: ctx.tenantId,
                itemId: input.itemId,
                lotCode: input.lotCode,
                unitId: input.unitId,
                locationId: input.locationId ?? null,
                expiresAt: input.expiresAt ?? null,
                receivedAt: input.receivedAt ?? null,
                unitCostAmount: input.unitCostAmount ?? null,
                unitCostCurrency: input.unitCostCurrency ?? null,
                ...(input.attributesJson !== undefined ? { attributesJson: input.attributesJson } : {}),
            },
            select: { id: true, lotCode: true, unitId: true },
        });
    }

    /**
     * First-Expiry-First-Out lot selection for an item: the non-deleted
     * lot with stock on hand whose contents expire soonest. Used by the
     * spray-completion CONSUMPTION path to pick which lot to draw from.
     * Returns null when the item has no lot with positive stock.
     */
    static async getFefoLot(db: PrismaTx, ctx: RequestContext, itemId: string) {
        return db.inventoryLot.findFirst({
            where: {
                tenantId: ctx.tenantId,
                itemId,
                deletedAt: null,
                quantityOnHand: { gt: 0 },
            },
            orderBy: [
                { expiresAt: { sort: 'asc', nulls: 'last' } },
                { receivedAt: { sort: 'asc', nulls: 'last' } },
                { createdAt: 'asc' },
            ],
            select: { id: true, unitId: true, lotCode: true, quantityOnHand: true },
        });
    }
}
