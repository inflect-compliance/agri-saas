/* eslint-disable @typescript-eslint/no-explicit-any -- standard test-mock pattern. */

/**
 * Unit tests for `listLedgerReconciliationHistory` — the read that
 * reconstructs the reconciliation timeline from `LEDGER_RECONCILIATION_RUN`
 * audit rows for the admin Ledger Integrity page.
 *
 * Mocks the audit repo + db-context; uses the REAL policy (makeRequestContext
 * grants canRead). Asserts the detailsJson → DTO mapping, including the
 * graceful-null path for legacy rows and the actor fallback chain.
 */

const mockDb = {} as any;

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/repositories/AuditLogRepository', () => ({
    AuditLogRepository: { listByAction: jest.fn() },
}));

import { listLedgerReconciliationHistory } from '@/app-layer/usecases/inventory';
import { AuditLogRepository } from '@/app-layer/repositories/AuditLogRepository';
import { makeRequestContext } from '../helpers/make-context';

const listByAction = AuditLogRepository.listByAction as jest.Mock;

const AT = new Date('2026-06-17T10:00:00.000Z');

beforeEach(() => jest.clearAllMocks());

describe('listLedgerReconciliationHistory', () => {
    it('queries the LEDGER_RECONCILIATION_RUN action, newest-first bounded', async () => {
        listByAction.mockResolvedValue([]);
        const ctx = makeRequestContext();

        const out = await listLedgerReconciliationHistory(ctx);

        expect(out).toEqual([]);
        expect(listByAction).toHaveBeenCalledWith(
            mockDb,
            ctx,
            'LEDGER_RECONCILIATION_RUN',
            50,
        );
    });

    it('maps an intact + balanced run from detailsJson.data', async () => {
        listByAction.mockResolvedValue([
            {
                id: 'a1',
                createdAt: AT,
                detailsJson: {
                    data: {
                        valid: true,
                        totalEntries: 42,
                        firstBreakAt: null,
                        firstBreakId: null,
                        balanceHealthy: true,
                        lotsChecked: 5,
                        driftCount: 0,
                        negativeCount: 0,
                    },
                },
                user: { name: 'Dana Grower', email: 'dana@farm.test' },
            },
        ]);

        const [run] = await listLedgerReconciliationHistory(makeRequestContext());

        expect(run).toEqual({
            id: 'a1',
            runAt: AT.toISOString(),
            valid: true,
            totalEntries: 42,
            firstBreakAt: null,
            firstBreakId: null,
            balanceHealthy: true,
            lotsChecked: 5,
            driftCount: 0,
            negativeCount: 0,
            runBy: 'Dana Grower',
        });
    });

    it('maps a chain-intact run whose BALANCE half drifted (negative on-hand)', async () => {
        listByAction.mockResolvedValue([
            {
                id: 'd4',
                createdAt: AT,
                detailsJson: {
                    data: {
                        valid: true,
                        totalEntries: 30,
                        firstBreakAt: null,
                        firstBreakId: null,
                        balanceHealthy: false,
                        lotsChecked: 8,
                        driftCount: 1,
                        negativeCount: 2,
                    },
                },
                user: { name: 'Ops', email: null },
            },
        ]);

        const [run] = await listLedgerReconciliationHistory(makeRequestContext());

        expect(run.valid).toBe(true);
        expect(run.balanceHealthy).toBe(false);
        expect(run.driftCount).toBe(1);
        expect(run.negativeCount).toBe(2);
        expect(run.lotsChecked).toBe(8);
    });

    it('maps a drift run with the break location', async () => {
        listByAction.mockResolvedValue([
            {
                id: 'b2',
                createdAt: AT,
                detailsJson: { data: { valid: false, totalEntries: 99, firstBreakAt: 7, firstBreakId: 'tx-bad' } },
                user: { name: null, email: 'ops@farm.test' },
            },
        ]);

        const [run] = await listLedgerReconciliationHistory(makeRequestContext());

        expect(run.valid).toBe(false);
        expect(run.firstBreakAt).toBe(7);
        expect(run.firstBreakId).toBe('tx-bad');
        // name is null → falls back to email
        expect(run.runBy).toBe('ops@farm.test');
    });

    it('degrades gracefully for a legacy row with no structured data', async () => {
        listByAction.mockResolvedValue([
            { id: 'c3', createdAt: AT, detailsJson: null, user: null },
        ]);

        const [run] = await listLedgerReconciliationHistory(makeRequestContext());

        expect(run).toEqual({
            id: 'c3',
            runAt: AT.toISOString(),
            valid: null,
            totalEntries: null,
            firstBreakAt: null,
            firstBreakId: null,
            balanceHealthy: null,
            lotsChecked: null,
            driftCount: null,
            negativeCount: null,
            runBy: null,
        });
    });

    it('honours a custom take', async () => {
        listByAction.mockResolvedValue([]);
        await listLedgerReconciliationHistory(makeRequestContext(), { take: 10 });
        expect(listByAction).toHaveBeenCalledWith(mockDb, expect.anything(), 'LEDGER_RECONCILIATION_RUN', 10);
    });
});
