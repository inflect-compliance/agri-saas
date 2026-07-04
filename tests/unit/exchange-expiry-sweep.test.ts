/**
 * Unit — Exchange EXPIRED sweep.
 *
 * Flips ONLY ACTIVE listings past their expiry (the where clause excludes
 * null / future / non-ACTIVE), emits one status_change audit row per
 * transition scoped to the seller tenant, honours the atomic-flip race guard,
 * and respects the batch cap. Prisma + audit are mocked (no DB).
 */
jest.mock('@/lib/audit', () => ({
    appendAuditEntry: jest.fn().mockResolvedValue({ id: 'a', entryHash: 'h', previousHash: null }),
}));
jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { appendAuditEntry } from '@/lib/audit';
import { runExchangeExpirySweep } from '@/app-layer/jobs/exchange-expiry-sweep';

const appendMock = appendAuditEntry as jest.MockedFunction<typeof appendAuditEntry>;

const NOW = new Date('2026-07-04T12:00:00Z');
function candidate(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'l1', sellerTenantId: 't1', commodity: 'Wheat', side: 'SELL',
        expiresAt: new Date('2026-07-01T00:00:00Z'), ...over,
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDb(rows: any[], updateCounts?: number[]) {
    const captured: Record<string, unknown> = {};
    let i = 0;
    const updateMany = jest.fn(async () => ({ count: updateCounts ? updateCounts[i++] : 1 }));
    const db = {
        exchangeListing: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            findMany: jest.fn(async (args: any) => { Object.assign(captured, args); return rows; }),
            updateMany,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { db, captured, updateMany };
}

beforeEach(() => appendMock.mockClear());

it('queries ACTIVE + past-expiry only, bounded and oldest-first', async () => {
    const { db, captured } = makeDb([]);
    await runExchangeExpirySweep(db, { now: NOW });
    expect(captured.where).toEqual({ status: 'ACTIVE', expiresAt: { not: null, lte: NOW } });
    expect(captured.take).toBe(500);
    expect(captured.orderBy).toEqual({ expiresAt: 'asc' });
});

it('flips each candidate atomically and emits one audit row per transition', async () => {
    const rows = [
        candidate({ id: 'l1', sellerTenantId: 't1', commodity: 'Wheat' }),
        candidate({ id: 'l2', sellerTenantId: 't2', commodity: 'Maize', side: 'BUY' }),
    ];
    const { db, updateMany } = makeDb(rows);
    const res = await runExchangeExpirySweep(db, { now: NOW });

    expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'l1', status: 'ACTIVE', expiresAt: { not: null, lte: NOW } },
        data: { status: 'EXPIRED' },
    });
    expect(appendMock).toHaveBeenCalledTimes(2);
    expect(appendMock).toHaveBeenCalledWith(
        expect.objectContaining({
            tenantId: 't1',
            entity: 'ExchangeListing',
            entityId: 'l1',
            actorType: 'SYSTEM',
            action: 'UPDATE',
            detailsJson: expect.objectContaining({
                category: 'status_change',
                fromStatus: 'ACTIVE',
                toStatus: 'EXPIRED',
            }),
        }),
    );
    expect(res).toEqual({ scanned: 2, transitionedToExpired: 2 });
});

it('skips a row whose atomic flip lost the race (count 0) — no audit, not counted', async () => {
    const rows = [candidate({ id: 'l1' }), candidate({ id: 'l2', sellerTenantId: 't2' })];
    const { db } = makeDb(rows, [0, 1]); // l1 lost the race, l2 flipped
    const res = await runExchangeExpirySweep(db, { now: NOW });
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'l2' }));
    expect(res).toEqual({ scanned: 2, transitionedToExpired: 1 });
});

it('is a no-op when nothing is past due', async () => {
    const { db, updateMany } = makeDb([]);
    const res = await runExchangeExpirySweep(db, { now: NOW });
    expect(updateMany).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 0, transitionedToExpired: 0 });
});

it('respects the batchSize option', async () => {
    const { db, captured } = makeDb([]);
    await runExchangeExpirySweep(db, { now: NOW, batchSize: 10 });
    expect(captured.take).toBe(10);
});
