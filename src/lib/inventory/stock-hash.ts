/**
 * Stock-ledger canonical hashing.
 *
 * The StockTransaction ledger is append-only and hash-chained per
 * tenant, exactly like AuditLog. This module is the inventory twin of
 * `src/lib/audit/canonical-hash.ts` — same deterministic SHA-256 over a
 * canonical JSON payload, reusing `canonicalJsonStringify` so the byte
 * discipline is shared rather than re-derived.
 *
 *   entryHash = SHA-256(canonicalJSON(payload))
 *
 * Decimal handling: Prisma `Decimal` values are normalised to a
 * fixed-scale string BEFORE hashing (quantityDelta → 4dp matching
 * DECIMAL(16,4); costAmount → 2dp matching DECIMAL(14,2)). Hashing the
 * raw Decimal object or its default `toString()` would be
 * non-deterministic across trailing-zero representations.
 *
 * @module inventory/stock-hash
 */
import { createHash } from 'crypto';
import { canonicalJsonStringify, toCanonicalTimestamp } from '@/lib/audit/canonical-hash';

/** Fields included in the stock-entry hash, in lexicographic order. */
export const STOCK_HASH_FIELDS = [
    'actorUserId',
    'costAmount',
    'costCurrency',
    'logEntryId',
    'lotId',
    'occurredAt',
    'previousHash',
    'quantityDelta',
    'reason',
    'tenantId',
    'type',
    'unitId',
    'version',
] as const;

export interface StockHashInput {
    tenantId: string;
    lotId: string;
    type: string;
    /** Canonical fixed-scale string (4dp). */
    quantityDelta: string;
    unitId: string;
    occurredAt: string; // ISO-8601 UTC
    logEntryId: string | null;
    reason: string | null;
    /** Canonical fixed-scale string (2dp) or null. */
    costAmount: string | null;
    costCurrency: string | null;
    actorUserId: string | null;
    previousHash: string | null;
    version: number;
}

/**
 * Normalise a decimal-ish value to a fixed-scale string. Accepts a
 * number, a string, or any object with a `toFixed` method (Prisma
 * Decimal). Returns null for null/undefined.
 */
export function decimalToCanonical(
    value: number | string | { toFixed(n: number): string } | null | undefined,
    scale: number,
): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value.toFixed(scale);
    if (typeof value === 'string') return Number(value).toFixed(scale);
    // Prisma Decimal (and Decimal.js) expose toFixed(scale).
    return value.toFixed(scale);
}

export function buildStockHashPayload(input: StockHashInput): Record<string, unknown> {
    return {
        actorUserId: input.actorUserId,
        costAmount: input.costAmount,
        costCurrency: input.costCurrency,
        logEntryId: input.logEntryId,
        lotId: input.lotId,
        occurredAt: input.occurredAt,
        previousHash: input.previousHash,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        tenantId: input.tenantId,
        type: input.type,
        unitId: input.unitId,
        version: input.version,
    };
}

/** Compute the lowercase hex SHA-256 entryHash for a stock ledger row. */
export function computeStockEntryHash(input: StockHashInput): string {
    const canonical = canonicalJsonStringify(buildStockHashPayload(input));
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export { toCanonicalTimestamp };
