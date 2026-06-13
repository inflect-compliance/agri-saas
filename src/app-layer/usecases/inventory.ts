import { RequestContext } from '../types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { badRequest, notFound } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import type { PrismaTx } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { InventoryRepository } from '../repositories/InventoryRepository';
import { JournalRepository } from '../repositories/JournalRepository';
import { ModuleSettingsRepository } from '../repositories/ModuleSettingsRepository';
import { resolveEnabledModules } from '@/lib/modules';
import { appendStockTransaction } from '@/lib/inventory/stock-ledger';

/**
 * Inventory — lots + the append-only stock ledger.
 *
 * Lot rows are created empty and filled by RECEIPT ledger entries (or
 * an initial-stock RECEIPT at creation). Every quantity change flows
 * through `appendStockTransaction` (the single hash-chained writer),
 * never a direct StockTransaction write. The lots list surfaces a
 * computed `lowStock` when an item's total on-hand drops below its
 * `reorderLevel`.
 *
 * `recordInputApplication` is the spray-completion bridge: called from
 * `markOperationParcel` inside its transaction, it writes the
 * INPUT_APPLICATION journal record and the CONSUMPTION ledger entry —
 * but only for the modules the tenant has enabled (WP-2).
 */

function toNum(d: unknown): number {
    if (d === null || d === undefined) return 0;
    return typeof d === 'number' ? d : Number(d as { toString(): string });
}

// ─── Reads ─────────────────────────────────────────────────────────

export async function listLots(ctx: RequestContext, opts: { itemId?: string; take?: number } = {}) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const lots = await InventoryRepository.listLots(db, ctx, opts);
        return lots.map((l) => {
            const onHand = toNum(l.quantityOnHand);
            const reorder = l.item.reorderLevel !== null ? toNum(l.item.reorderLevel) : null;
            return {
                id: l.id,
                lotCode: l.lotCode,
                item: { id: l.item.id, name: l.item.name, category: l.item.category },
                unit: { id: l.unit.id, symbol: l.unit.symbol },
                location: l.location ? { id: l.location.id, name: l.location.name } : null,
                quantityOnHand: onHand,
                expiresAt: l.expiresAt,
                receivedAt: l.receivedAt,
                lowStock: reorder !== null ? onHand < reorder : false,
            };
        });
    });
}

export async function getLot(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const lot = await InventoryRepository.getLot(db, ctx, id);
        if (!lot) throw notFound('Lot not found');
        const ledger = await InventoryRepository.lotLedger(db, ctx, id);
        return {
            id: lot.id,
            lotCode: lot.lotCode,
            item: lot.item,
            unit: lot.unit,
            location: lot.location,
            quantityOnHand: toNum(lot.quantityOnHand),
            expiresAt: lot.expiresAt,
            receivedAt: lot.receivedAt,
            ledger: ledger.map((t) => ({
                id: t.id,
                type: t.type,
                quantityDelta: toNum(t.quantityDelta),
                unitSymbol: t.unit.symbol,
                occurredAt: t.occurredAt,
                reason: t.reason,
                actor: t.actor ? { id: t.actor.id, name: t.actor.name } : null,
                entryHash: t.entryHash,
            })),
        };
    });
}

// ─── Writes ────────────────────────────────────────────────────────

export interface CreateLotInput {
    itemId: string;
    lotCode: string;
    locationId?: string | null;
    expiresAt?: string | null;
    receivedAt?: string | null;
    unitCostAmount?: number | null;
    unitCostCurrency?: string | null;
    /** Optional initial stock — posted as a RECEIPT ledger entry. */
    initialQuantity?: number | null;
}

export async function createLot(ctx: RequestContext, input: CreateLotInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await InventoryRepository.getItem(db, ctx, input.itemId);
        if (!item) throw badRequest('Item not found.');

        const lotCode = sanitizePlainText(input.lotCode.trim());
        if (!lotCode) throw badRequest('Lot code is required.');

        const lot = await InventoryRepository.createLot(db, ctx, {
            itemId: item.id,
            lotCode,
            unitId: item.defaultUnitId,
            locationId: input.locationId ?? null,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
            unitCostAmount: input.unitCostAmount ?? null,
            unitCostCurrency: input.unitCostCurrency ?? null,
        });

        if (input.initialQuantity && input.initialQuantity > 0) {
            await appendStockTransaction(db, ctx, {
                lotId: lot.id,
                type: 'RECEIPT',
                quantityDelta: input.initialQuantity,
                unitId: lot.unitId,
                costAmount: input.unitCostAmount ?? null,
                costCurrency: input.unitCostCurrency ?? null,
            });
        }

        await logEvent(db, ctx, {
            action: 'INVENTORY_LOT_CREATED',
            entityType: 'InventoryLot',
            entityId: lot.id,
            details: `Created lot ${lot.lotCode} for item ${item.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'InventoryLot',
                operation: 'created',
                after: { itemId: item.id, lotCode: lot.lotCode, initialQuantity: input.initialQuantity ?? 0 },
                summary: `Created inventory lot ${lot.lotCode}`,
            },
        });

        return { id: lot.id, lotCode: lot.lotCode };
    });
}

export async function receiveStock(ctx: RequestContext, lotId: string, quantity: number) {
    assertCanWrite(ctx);
    if (!(quantity > 0)) throw badRequest('Receipt quantity must be positive.');
    return runInTenantContext(ctx, async (db) => {
        const lot = await InventoryRepository.getLot(db, ctx, lotId);
        if (!lot) throw notFound('Lot not found');
        const res = await appendStockTransaction(db, ctx, {
            lotId,
            type: 'RECEIPT',
            quantityDelta: quantity,
            unitId: lot.unit.id,
        });
        await logEvent(db, ctx, {
            action: 'STOCK_RECEIVED',
            entityType: 'InventoryLot',
            entityId: lotId,
            details: `Received ${quantity} ${lot.unit.symbol} into lot ${lot.lotCode}`,
            detailsJson: {
                category: 'custom',
                summary: `Stock received into lot ${lot.lotCode}`,
                data: { lotId, quantity, onHand: res.quantityOnHand },
            },
        });
        return { quantityOnHand: res.quantityOnHand, entryHash: res.entryHash };
    });
}

export async function adjustStock(ctx: RequestContext, lotId: string, delta: number, reason: string) {
    assertCanWrite(ctx);
    if (!Number.isFinite(delta) || delta === 0) throw badRequest('Adjustment delta must be non-zero.');
    const cleanReason = sanitizePlainText((reason ?? '').trim());
    if (!cleanReason) throw badRequest('Adjustment reason is required.');
    return runInTenantContext(ctx, async (db) => {
        const lot = await InventoryRepository.getLot(db, ctx, lotId);
        if (!lot) throw notFound('Lot not found');
        const res = await appendStockTransaction(db, ctx, {
            lotId,
            type: 'ADJUSTMENT',
            quantityDelta: delta,
            unitId: lot.unit.id,
            reason: cleanReason,
        });
        await logEvent(db, ctx, {
            action: 'STOCK_ADJUSTED',
            entityType: 'InventoryLot',
            entityId: lotId,
            details: `Adjusted lot ${lot.lotCode} by ${delta} ${lot.unit.symbol}: ${cleanReason}`,
            detailsJson: {
                category: 'custom',
                summary: `Stock adjusted on lot ${lot.lotCode}`,
                data: { lotId, delta, reason: cleanReason, onHand: res.quantityOnHand },
            },
        });
        return { quantityOnHand: res.quantityOnHand, entryHash: res.entryHash };
    });
}

// ─── Spray-completion bridge (WP-2 module-gated) ───────────────────

/** The OperationParcel fields recordInputApplication needs. */
export interface InputApplicationLine {
    id: string;
    parcelId: string;
    productItemId: string;
    doseValue: unknown; // Prisma Decimal
    doseUnitId: string;
}

export interface InputApplicationResult {
    journalEntryId: string | null;
    consumed: number;
    deductedFromLotId: string | null;
    /** Why no deduction happened, when applicable. */
    note?: 'inventory_disabled' | 'no_lot_available' | 'zero_quantity';
}

/**
 * Emit the field record + stock effect of completing a spray line.
 * Runs INSIDE the caller's tenant transaction (`db`). Module-gated via a
 * non-throwing read of TenantModuleSettings on the same handle (so no
 * nested transaction): JOURNAL drives the LogEntry, INVENTORY drives the
 * CONSUMPTION. Lot selection is FEFO; if the product has no lot with
 * stock the consumption is skipped (the journal record still stands).
 */
export async function recordInputApplication(
    db: PrismaTx,
    ctx: RequestContext,
    line: InputApplicationLine,
): Promise<InputApplicationResult> {
    const modules = resolveEnabledModules(await ModuleSettingsRepository.get(db, ctx));
    const journalOn = modules.includes('JOURNAL');
    const inventoryOn = modules.includes('INVENTORY');
    if (!journalOn && !inventoryOn) {
        return { journalEntryId: null, consumed: 0, deductedFromLotId: null, note: 'inventory_disabled' };
    }

    const [parcel, product] = await Promise.all([
        db.parcel.findFirst({
            where: { id: line.parcelId, tenantId: ctx.tenantId },
            select: { name: true, areaHa: true },
        }),
        db.item.findFirst({
            where: { id: line.productItemId, tenantId: ctx.tenantId },
            select: { id: true, name: true, defaultUnitId: true },
        }),
    ]);
    if (!parcel || !product) {
        return { journalEntryId: null, consumed: 0, deductedFromLotId: null, note: 'zero_quantity' };
    }

    const units = await db.unit.findMany({
        where: { id: { in: [line.doseUnitId, product.defaultUnitId] } },
        select: { id: true, measure: true, symbol: true },
    });
    const doseUnit = units.find((u) => u.id === line.doseUnitId);
    const productUnit = units.find((u) => u.id === product.defaultUnitId);

    // RATE dose (e.g. L/ha) is multiplied by parcel area; a flat dose is
    // taken as-is. Phase-1 simplification: no cross-unit conversion — the
    // product's default unit is assumed to match the rate's numerator.
    const areaHa = parcel.areaHa !== null ? toNum(parcel.areaHa) : 0;
    const dose = toNum(line.doseValue);
    const consumedRaw = doseUnit?.measure === 'RATE' ? dose * areaHa : dose;
    const consumed = Math.round(consumedRaw * 1e4) / 1e4;

    // 1 — journal record (the compliant spray record).
    let journalEntryId: string | null = null;
    if (journalOn) {
        const entry = await JournalRepository.createLogEntry(db, ctx, {
            type: 'INPUT_APPLICATION',
            title: `Applied ${product.name} to ${parcel.name}`,
            operationParcelId: line.id,
            quantities:
                consumed > 0 && productUnit
                    ? [
                          {
                              measure: productUnit.measure,
                              value: consumed,
                              unitId: product.defaultUnitId,
                              label: 'Applied',
                          },
                      ]
                    : [],
        });
        journalEntryId = entry.id;
    }

    // 2 — stock effect (CONSUMPTION) against the FEFO lot.
    let deductedFromLotId: string | null = null;
    let note: InputApplicationResult['note'];
    if (inventoryOn && consumed > 0) {
        const lot = await InventoryRepository.getFefoLot(db, ctx, product.id);
        if (lot) {
            await appendStockTransaction(db, ctx, {
                lotId: lot.id,
                type: 'CONSUMPTION',
                quantityDelta: -consumed,
                unitId: lot.unitId,
                logEntryId: journalEntryId,
                actorUserId: ctx.userId ?? null,
            });
            deductedFromLotId = lot.id;
        } else {
            note = 'no_lot_available';
        }
    } else if (consumed <= 0) {
        note = 'zero_quantity';
    }

    return { journalEntryId, consumed, deductedFromLotId, note };
}
