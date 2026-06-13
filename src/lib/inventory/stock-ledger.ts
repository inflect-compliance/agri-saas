/**
 * Stock ledger writer + verifier.
 *
 * This is the ONLY module that may INSERT into StockTransaction. Every
 * append flows through `appendStockTransaction` so that, within one
 * advisory-locked step:
 *   1. the per-tenant hash chain (previousHash → entryHash) is extended,
 *   2. the row is inserted, and
 *   3. the denormalised `InventoryLot.quantityOnHand` cache is recomputed
 *      from the ledger sum.
 *
 * It runs inside the CALLER's `runInTenantContext` transaction (the `db`
 * handle) so the append is atomic with whatever drove it — a lot
 * receipt, an adjustment, or the spray-completion CONSUMPTION. The
 * StockTransaction table is append-only (DB trigger blocks UPDATE/DELETE);
 * corrections are posted as ADJUSTMENT entries, never edits.
 *
 * Direct `db.stockTransaction.create/update/delete` from usecases is
 * banned by `tests/guardrails/no-direct-stock-writes.test.ts`.
 *
 * @module inventory/stock-ledger
 */
import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '@/app-layer/types';
import {
    computeStockEntryHash,
    decimalToCanonical,
    toCanonicalTimestamp,
} from './stock-hash';

/** Hash-chain version for stock entries. */
export const STOCK_HASH_VERSION = 1;

const QUANTITY_SCALE = 4; // DECIMAL(16,4)
const COST_SCALE = 2; // DECIMAL(14,2)

export interface StockAppendInput {
    lotId: string;
    type:
        | 'RECEIPT'
        | 'CONSUMPTION'
        | 'HARVEST_IN'
        | 'TRANSFER'
        | 'ADJUSTMENT'
        | 'SALE_OUT'
        | 'DISPOSAL';
    /** Signed delta: positive = stock in, negative = stock out. */
    quantityDelta: number;
    unitId: string;
    occurredAt?: Date;
    logEntryId?: string | null;
    reason?: string | null;
    costAmount?: number | null;
    costCurrency?: string | null;
    actorUserId?: string | null;
}

export interface StockAppendResult {
    id: string;
    entryHash: string;
    previousHash: string | null;
    quantityOnHand: string;
}

/**
 * Append one row to the tenant's stock ledger and refresh the lot cache.
 * MUST be called inside a `runInTenantContext` transaction.
 */
export async function appendStockTransaction(
    db: PrismaTx,
    ctx: RequestContext,
    input: StockAppendInput,
): Promise<StockAppendResult> {
    // 1 — serialise appends for this tenant's chain (distinct lock
    //     namespace from the audit chain's `hashtext(tenantId)`).
    await db.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `stock:${ctx.tenantId}`,
    );

    // 2 — the tail of the chain (deterministic total order).
    const last = await db.stockTransaction.findFirst({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { entryHash: true },
    });
    const previousHash = last?.entryHash ?? null;

    const occurredAt = input.occurredAt ?? new Date();
    const quantityCanonical = decimalToCanonical(input.quantityDelta, QUANTITY_SCALE)!;
    const costCanonical = decimalToCanonical(input.costAmount ?? null, COST_SCALE);

    const entryHash = computeStockEntryHash({
        tenantId: ctx.tenantId,
        lotId: input.lotId,
        type: input.type,
        quantityDelta: quantityCanonical,
        unitId: input.unitId,
        occurredAt: toCanonicalTimestamp(occurredAt),
        logEntryId: input.logEntryId ?? null,
        reason: input.reason ?? null,
        costAmount: costCanonical,
        costCurrency: input.costCurrency ?? null,
        actorUserId: input.actorUserId ?? ctx.userId ?? null,
        previousHash,
        version: STOCK_HASH_VERSION,
    });

    // 3 — append (INSERT is permitted; only UPDATE/DELETE are blocked).
    const row = await db.stockTransaction.create({
        data: {
            tenantId: ctx.tenantId,
            lotId: input.lotId,
            type: input.type,
            quantityDelta: input.quantityDelta,
            unitId: input.unitId,
            occurredAt,
            logEntryId: input.logEntryId ?? null,
            reason: input.reason ?? null,
            costAmount: input.costAmount ?? null,
            costCurrency: input.costCurrency ?? null,
            actorUserId: input.actorUserId ?? ctx.userId ?? null,
            previousHash,
            entryHash,
        },
        select: { id: true, entryHash: true, previousHash: true },
    });

    // 4 — refresh the denormalised on-hand cache from the ledger sum.
    const agg = await db.stockTransaction.aggregate({
        where: { tenantId: ctx.tenantId, lotId: input.lotId },
        _sum: { quantityDelta: true },
    });
    const onHand = agg._sum.quantityDelta ?? 0;
    await db.inventoryLot.update({
        where: { id: input.lotId },
        data: { quantityOnHand: onHand },
    });

    return {
        id: row.id,
        entryHash: row.entryHash,
        previousHash: row.previousHash,
        quantityOnHand: decimalToCanonical(onHand as unknown as { toFixed(n: number): string }, QUANTITY_SCALE)!,
    };
}

export interface StockChainVerification {
    tenantId: string;
    totalEntries: number;
    valid: boolean;
    firstBreakAt?: number;
    firstBreakId?: string;
}

/**
 * Recompute the tenant's stock chain from scratch and report integrity.
 * Walks in the same total order the writer uses (createdAt ASC, id ASC).
 */
export async function verifyStockChain(
    db: PrismaTx,
    tenantId: string,
): Promise<StockChainVerification> {
    const rows = await db.stockTransaction.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            lotId: true,
            type: true,
            quantityDelta: true,
            unitId: true,
            occurredAt: true,
            logEntryId: true,
            reason: true,
            costAmount: true,
            costCurrency: true,
            actorUserId: true,
            previousHash: true,
            entryHash: true,
        },
        // guardrail-allow: unbounded — integrity sweep must read the full chain.
    });

    let valid = true;
    let expectedPrev: string | null = null;
    let firstBreakAt: number | undefined;
    let firstBreakId: string | undefined;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.previousHash !== expectedPrev && !(i === 0 && r.previousHash === null)) {
            valid = false;
            firstBreakAt = i;
            firstBreakId = r.id;
            break;
        }
        const recomputed = computeStockEntryHash({
            tenantId,
            lotId: r.lotId,
            type: r.type,
            quantityDelta: decimalToCanonical(r.quantityDelta as unknown as { toFixed(n: number): string }, QUANTITY_SCALE)!,
            unitId: r.unitId,
            occurredAt: toCanonicalTimestamp(r.occurredAt),
            logEntryId: r.logEntryId,
            reason: r.reason,
            costAmount: decimalToCanonical(
                (r.costAmount as unknown as { toFixed(n: number): string } | null),
                COST_SCALE,
            ),
            costCurrency: r.costCurrency,
            actorUserId: r.actorUserId,
            previousHash: r.previousHash,
            version: STOCK_HASH_VERSION,
        });
        if (recomputed !== r.entryHash) {
            valid = false;
            firstBreakAt = i;
            firstBreakId = r.id;
            break;
        }
        expectedPrev = r.entryHash;
    }

    return { tenantId, totalEntries: rows.length, valid, firstBreakAt, firstBreakId };
}
