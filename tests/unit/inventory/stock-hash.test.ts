/**
 * Unit tests for the stock-ledger canonical hashing
 * (`src/lib/inventory/stock-hash.ts`). The chain's integrity rests on
 * this being deterministic + sensitive to every hashed field.
 */
import {
    computeStockEntryHash,
    decimalToCanonical,
    buildStockHashPayload,
    STOCK_HASH_FIELDS,
    type StockHashInput,
} from '@/lib/inventory/stock-hash';

const base: StockHashInput = {
    tenantId: 'tenant-1',
    lotId: 'lot-1',
    type: 'CONSUMPTION',
    quantityDelta: '-2.5000',
    unitId: 'unit-l',
    occurredAt: '2026-06-13T10:00:00.000Z',
    logEntryId: 'log-1',
    reason: null,
    costAmount: null,
    costCurrency: null,
    actorUserId: 'user-1',
    previousHash: null,
    version: 1,
};

describe('decimalToCanonical', () => {
    it('formats numbers to the requested scale', () => {
        expect(decimalToCanonical(2.5, 4)).toBe('2.5000');
        expect(decimalToCanonical(-2.5, 4)).toBe('-2.5000');
        expect(decimalToCanonical(10, 2)).toBe('10.00');
    });
    it('formats strings + Decimal-like objects', () => {
        expect(decimalToCanonical('3.14159', 4)).toBe('3.1416');
        expect(decimalToCanonical({ toFixed: (n: number) => (1.2).toFixed(n) }, 4)).toBe('1.2000');
    });
    it('returns null for null/undefined', () => {
        expect(decimalToCanonical(null, 4)).toBeNull();
        expect(decimalToCanonical(undefined, 2)).toBeNull();
    });
});

describe('computeStockEntryHash', () => {
    it('is a 64-char lowercase hex sha256', () => {
        const h = computeStockEntryHash(base);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for identical input', () => {
        expect(computeStockEntryHash(base)).toBe(computeStockEntryHash({ ...base }));
    });

    it('changes when ANY hashed field changes', () => {
        const ref = computeStockEntryHash(base);
        const mutations: Partial<StockHashInput>[] = [
            { tenantId: 'tenant-2' },
            { lotId: 'lot-2' },
            { type: 'RECEIPT' },
            { quantityDelta: '-2.5001' },
            { unitId: 'unit-kg' },
            { occurredAt: '2026-06-13T10:00:00.001Z' },
            { logEntryId: 'log-2' },
            { reason: 'x' },
            { costAmount: '1.00' },
            { costCurrency: 'EUR' },
            { actorUserId: 'user-2' },
            { previousHash: 'deadbeef' },
            { version: 2 },
        ];
        for (const m of mutations) {
            expect(computeStockEntryHash({ ...base, ...m })).not.toBe(ref);
        }
    });

    it('chains: previousHash threads into the next hash', () => {
        const first = computeStockEntryHash(base);
        const second = computeStockEntryHash({ ...base, previousHash: first, quantityDelta: '5.0000', type: 'RECEIPT' });
        const secondWrongPrev = computeStockEntryHash({ ...base, previousHash: 'nope', quantityDelta: '5.0000', type: 'RECEIPT' });
        expect(second).not.toBe(secondWrongPrev);
    });

    it('payload contains exactly the documented field set', () => {
        const payload = buildStockHashPayload(base);
        expect(Object.keys(payload).sort()).toEqual([...STOCK_HASH_FIELDS].sort());
    });
});
