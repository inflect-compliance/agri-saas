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
import { appendStockTransaction, appendLotLink } from '@/lib/inventory/stock-ledger';

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

/**
 * Map a raw lot row (with item/unit/location includes) to the wire DTO —
 * Decimal `quantityOnHand` → number + computed `lowStock`. Shared by the
 * array and cursor-paginated list paths so both serialise identically
 * (see src/lib/dto/inventory.dto.ts::InventoryLotDTOSchema).
 */
function mapLotRow(l: {
    id: string;
    lotCode: string;
    item: { id: string; name: string; category: string; reorderLevel: unknown };
    unit: { id: string; symbol: string };
    location: { id: string; name: string } | null;
    quantityOnHand: unknown;
    expiresAt: Date | null;
    receivedAt: Date | null;
}) {
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
}

export async function listLots(ctx: RequestContext, opts: { itemId?: string; take?: number } = {}) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const lots = await InventoryRepository.listLots(db, ctx, opts);
        return lots.map(mapLotRow);
    });
}

/**
 * Cursor-paginated lots — the dual-mode `GET /inventory/lots?limit=&cursor=`
 * path for inventory traceability on large fields. Returns
 * `{ items: InventoryLot[], pageInfo }`; items map identically to `listLots`.
 */
export async function listLotsPaginated(
    ctx: RequestContext,
    params: { limit?: number; cursor?: string; itemId?: string } = {},
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const page = await InventoryRepository.listLotsPaginated(db, ctx, params);
        return {
            items: (page.items as Parameters<typeof mapLotRow>[0][]).map(mapLotRow),
            pageInfo: page.pageInfo,
        };
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

interface LedgerRowRaw {
    id: string;
    type: string;
    quantityDelta: unknown;
    unit: { symbol: string };
    occurredAt: Date;
    reason: string | null;
    actor: { id: string; name: string | null } | null;
    entryHash: string;
}

/**
 * Cursor-paginated ledger for a lot — the deep-history companion to
 * `getLot` (whose inline `ledger` is the recent first page). Each entry
 * has the same shape as the getLot ledger rows; `pageInfo` carries the
 * next cursor. Backed by the `[tenantId, lotId, createdAt]` index.
 */
export async function listLotLedger(
    ctx: RequestContext,
    lotId: string,
    params: { limit?: number; cursor?: string } = {},
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const lot = await InventoryRepository.getLot(db, ctx, lotId);
        if (!lot) throw notFound('Lot not found');
        const page = await InventoryRepository.lotLedgerPage(db, ctx, lotId, params);
        return {
            items: (page.items as LedgerRowRaw[]).map((t) => ({
                id: t.id,
                type: t.type,
                quantityDelta: toNum(t.quantityDelta),
                unitSymbol: t.unit.symbol,
                occurredAt: t.occurredAt,
                reason: t.reason,
                actor: t.actor ? { id: t.actor.id, name: t.actor.name } : null,
                entryHash: t.entryHash,
            })),
            pageInfo: page.pageInfo,
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

// ─── Harvest → lot wiring (HARVEST_IN + genealogy) ─────────────────

/** What a HARVEST journal entry needs to mint an output lot. */
export interface HarvestLotInput {
    /** The HARVEST LogEntry that produced this lot (provenance link). */
    logEntryId: string;
    /** The harvested-produce Item the new lot holds. */
    itemId: string;
    /** Harvested amount (positive); posted as the HARVEST_IN delta. */
    quantity: number;
    /** Optional explicit lot code; auto-derived from the entry otherwise. */
    lotCode?: string | null;
    /** Storage Location the harvest lot lands in (a barn/silo). */
    locationId?: string | null;
    expiresAt?: string | null;
    /** The field harvested — drives both the recorded provenance and the
     *  DERIVATION genealogy (input lots consumed on this parcel). */
    parcelId?: string | null;
    /** Extra explicit parent lots to link (seed lots not auto-discovered). */
    sourceLotIds?: string[];
    costAmount?: number | null;
    costCurrency?: string | null;
}

export interface HarvestLotResult {
    lotId: string | null;
    lotCode: string | null;
    /** How many DERIVATION genealogy edges were recorded. */
    derivedFrom: number;
    note?: 'inventory_disabled' | 'item_not_found' | 'zero_quantity';
}

/**
 * Mint the inventory lot a HARVEST journal entry produces, post its
 * HARVEST_IN ledger entry, and record lot genealogy. Runs INSIDE the
 * caller's tenant transaction (`db`) — called from `journal.createLogEntry`
 * when a HARVEST entry carries a `harvest` payload. INVENTORY-module
 * gated: with inventory off the journal entry still stands, no lot is
 * minted. Genealogy: every input lot CONSUMED on `parcelId` (plus any
 * explicit `sourceLotIds`) becomes a DERIVATION parent of the harvest
 * lot, so the traceability walk threads seed-lot → field → harvest-lot.
 */
export async function recordHarvestLot(
    db: PrismaTx,
    ctx: RequestContext,
    input: HarvestLotInput,
): Promise<HarvestLotResult> {
    const modules = resolveEnabledModules(await ModuleSettingsRepository.get(db, ctx));
    if (!modules.includes('INVENTORY')) {
        return { lotId: null, lotCode: null, derivedFrom: 0, note: 'inventory_disabled' };
    }
    if (!(input.quantity > 0)) {
        return { lotId: null, lotCode: null, derivedFrom: 0, note: 'zero_quantity' };
    }

    const item = await InventoryRepository.getItem(db, ctx, input.itemId);
    if (!item) {
        return { lotId: null, lotCode: null, derivedFrom: 0, note: 'item_not_found' };
    }

    const lotCode =
        sanitizePlainText((input.lotCode ?? '').trim()) ||
        `HARV-${new Date().toISOString().slice(0, 10)}-${input.logEntryId.slice(-6)}`;

    const lot = await InventoryRepository.createLot(db, ctx, {
        itemId: item.id,
        lotCode,
        unitId: item.defaultUnitId,
        locationId: input.locationId ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        receivedAt: new Date(),
        ...(input.parcelId ? { attributesJson: { harvestedFromParcelId: input.parcelId } } : {}),
    });

    // HARVEST_IN — the output stock, chained + linked to the journal entry.
    await appendStockTransaction(db, ctx, {
        lotId: lot.id,
        type: 'HARVEST_IN',
        quantityDelta: input.quantity,
        unitId: lot.unitId,
        logEntryId: input.logEntryId,
        costAmount: input.costAmount ?? null,
        costCurrency: input.costCurrency ?? null,
        actorUserId: ctx.userId ?? null,
    });

    // Genealogy — input lots consumed on the field + any explicit sources.
    const parentIds = new Set<string>(input.sourceLotIds ?? []);
    if (input.parcelId) {
        for (const id of await InventoryRepository.findInputLotsConsumedOnParcel(db, ctx, input.parcelId)) {
            parentIds.add(id);
        }
    }
    parentIds.delete(lot.id); // never self-derive
    let derivedFrom = 0;
    for (const parentLotId of parentIds) {
        const { created } = await appendLotLink(db, ctx, {
            parentLotId,
            childLotId: lot.id,
            type: 'DERIVATION',
            logEntryId: input.logEntryId,
        });
        if (created) derivedFrom += 1;
    }

    await logEvent(db, ctx, {
        action: 'HARVEST_LOT_CREATED',
        entityType: 'InventoryLot',
        entityId: lot.id,
        details: `Harvest produced lot ${lot.lotCode} of ${item.name} (${input.quantity})`,
        detailsJson: {
            category: 'entity_lifecycle',
            entityName: 'InventoryLot',
            operation: 'created',
            after: { itemId: item.id, lotCode: lot.lotCode, quantity: input.quantity, derivedFrom },
            summary: `Harvest lot ${lot.lotCode} created from ${derivedFrom} input lot(s)`,
        },
    });

    return { lotId: lot.id, lotCode: lot.lotCode, derivedFrom };
}

// ─── Traceability walk (seed-lot → field → harvest-lot) ────────────

const TRACE_MAX_DEPTH = 12;

export interface TraceLotNode {
    id: string;
    lotCode: string;
    item: { id: string; name: string; category: string };
    unitSymbol: string;
    quantityOnHand: number;
    /** Fields this lot touched — consumed-on parcels + (harvest) source field. */
    fields: { id: string; name: string }[];
}

export interface TraceLotEdge {
    parentLotId: string;
    childLotId: string;
    type: string;
}

export interface TraceLotResult {
    root: TraceLotNode;
    /** Upstream input/seed lots (BFS up the genealogy graph). */
    ancestors: TraceLotNode[];
    /** Downstream harvest/output lots (BFS down). */
    descendants: TraceLotNode[];
    edges: TraceLotEdge[];
}

/**
 * Walk a lot's provenance both ways: ancestors (the seed/input lots it
 * derives from) and descendants (the harvest lots derived from it),
 * annotating every lot with the fields it touched. This is the
 * food-safety recall query — "given this seed lot, which fields and which
 * harvest lots are implicated?" and its inverse.
 */
export async function traceLot(ctx: RequestContext, rootLotId: string): Promise<TraceLotResult> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const [root] = await InventoryRepository.getLotsByIds(db, ctx, [rootLotId]);
        if (!root) throw notFound('Lot not found');

        const edges: TraceLotEdge[] = [];
        const seen = new Set<string>([rootLotId]);

        // BFS up (ancestors) and down (descendants), one query per level.
        const ancestorIds = new Set<string>();
        let frontier = [rootLotId];
        for (let depth = 0; depth < TRACE_MAX_DEPTH && frontier.length; depth++) {
            const links = await InventoryRepository.listParentLinks(db, ctx, frontier);
            const next: string[] = [];
            for (const l of links) {
                edges.push({ parentLotId: l.parentLotId, childLotId: l.childLotId, type: l.type });
                if (!seen.has(l.parentLotId)) {
                    seen.add(l.parentLotId);
                    ancestorIds.add(l.parentLotId);
                    next.push(l.parentLotId);
                }
            }
            frontier = next;
        }

        const descendantIds = new Set<string>();
        frontier = [rootLotId];
        const seenDown = new Set<string>([rootLotId]);
        for (let depth = 0; depth < TRACE_MAX_DEPTH && frontier.length; depth++) {
            const links = await InventoryRepository.listChildLinks(db, ctx, frontier);
            const next: string[] = [];
            for (const l of links) {
                edges.push({ parentLotId: l.parentLotId, childLotId: l.childLotId, type: l.type });
                if (!seenDown.has(l.childLotId)) {
                    seenDown.add(l.childLotId);
                    descendantIds.add(l.childLotId);
                    next.push(l.childLotId);
                }
            }
            frontier = next;
        }

        const allIds = [rootLotId, ...ancestorIds, ...descendantIds];
        const lots = await InventoryRepository.getLotsByIds(db, ctx, allIds);

        // Fields per lot: consumed-on parcels + (harvest) recorded source field.
        const consumptions = await InventoryRepository.findConsumptionParcels(db, ctx, allIds);
        const fieldsByLot = new Map<string, Map<string, string>>();
        const addField = (lotId: string, id: string | undefined, name: string | undefined) => {
            if (!id || !name) return;
            if (!fieldsByLot.has(lotId)) fieldsByLot.set(lotId, new Map());
            fieldsByLot.get(lotId)!.set(id, name);
        };
        for (const c of consumptions) {
            addField(c.lotId, c.logEntry?.operationParcel?.parcel?.id, c.logEntry?.operationParcel?.parcel?.name);
        }
        // Harvest lots record their source field in attributesJson; resolve names in one query.
        const harvestParcelIds = new Map<string, string>(); // lotId → parcelId
        for (const l of lots) {
            const pid = (l.attributesJson as { harvestedFromParcelId?: string } | null)?.harvestedFromParcelId;
            if (pid) harvestParcelIds.set(l.id, pid);
        }
        if (harvestParcelIds.size) {
            const parcels = await db.parcel.findMany({
                where: { tenantId: ctx.tenantId, id: { in: [...new Set(harvestParcelIds.values())] } },
                select: { id: true, name: true },
            });
            const pname = new Map(parcels.map((p) => [p.id, p.name]));
            for (const [lotId, pid] of harvestParcelIds) addField(lotId, pid, pname.get(pid));
        }

        const toNode = (l: (typeof lots)[number]): TraceLotNode => ({
            id: l.id,
            lotCode: l.lotCode,
            item: { id: l.item.id, name: l.item.name, category: l.item.category },
            unitSymbol: l.unit.symbol,
            quantityOnHand: toNum(l.quantityOnHand),
            fields: [...(fieldsByLot.get(l.id) ?? new Map()).entries()].map(([id, name]) => ({ id, name })),
        });
        const byId = new Map(lots.map((l) => [l.id, l]));

        return {
            root: toNode(byId.get(rootLotId)!),
            ancestors: [...ancestorIds].map((id) => byId.get(id)).filter(Boolean).map((l) => toNode(l!)),
            descendants: [...descendantIds].map((id) => byId.get(id)).filter(Boolean).map((l) => toNode(l!)),
            edges,
        };
    });
}
