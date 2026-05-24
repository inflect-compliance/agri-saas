/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks. */
/**
 * Unit tests for `getControlEffectiveness` (Audit S2, 2026-05-22).
 *
 * Rolling pass-rate metric over a configurable window. Aggregates
 * COMPLETED runs grouped by `result` (PASS / FAIL / INCONCLUSIVE) and
 * returns the percentage with the count breakdown.
 */
const policyCalls: string[] = [];

jest.mock('@/app-layer/policies/test.policies', () => ({
    assertCanReadTests: jest.fn(() => policyCalls.push('read-tests')),
    assertCanManageTestPlans: jest.fn(),
    assertCanExecuteTests: jest.fn(),
    assertCanLinkTestEvidence: jest.fn(),
}));

const tenantDb: any = {
    controlTestRun: { groupBy: jest.fn() },
};
jest.mock('@/lib/db-context', () => {
    const actual = jest.requireActual('@/lib/db-context');
    return {
        ...actual,
        runInTenantContext: jest.fn(async (_ctx: any, cb: any) => cb(tenantDb)),
    };
});

import { getControlEffectiveness } from '@/app-layer/usecases/control-test';
import { assertCanReadTests } from '@/app-layer/policies/test.policies';
import { makeRequestContext } from '../../helpers/make-context';

beforeEach(() => {
    policyCalls.length = 0;
    tenantDb.controlTestRun.groupBy.mockReset();
});

const ctx = makeRequestContext('READER');

describe('getControlEffectiveness', () => {
    it('invokes assertCanReadTests before the DB read', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([]);
        await getControlEffectiveness(ctx, 'c-1');
        expect(assertCanReadTests).toHaveBeenCalledWith(ctx);
        expect(policyCalls).toEqual(['read-tests']);
    });

    it('returns passRate: null when no completed runs in window', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([]);
        const out = await getControlEffectiveness(ctx, 'c-1');
        expect(out).toEqual({
            controlId: 'c-1',
            passRate: null,
            total: 0,
            passes: 0,
            fails: 0,
            inconclusive: 0,
            windowDays: 90,
        });
    });

    it('computes pass rate correctly from PASS/FAIL/INCONCLUSIVE groups', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([
            { result: 'PASS', _count: { _all: 7 } },
            { result: 'FAIL', _count: { _all: 2 } },
            { result: 'INCONCLUSIVE', _count: { _all: 1 } },
        ]);
        const out = await getControlEffectiveness(ctx, 'c-1');
        expect(out.passes).toBe(7);
        expect(out.fails).toBe(2);
        expect(out.inconclusive).toBe(1);
        expect(out.total).toBe(10);
        expect(out.passRate).toBe(70); // 7/10 = 70%
    });

    it('all PASS → passRate 100', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([
            { result: 'PASS', _count: { _all: 5 } },
        ]);
        const out = await getControlEffectiveness(ctx, 'c-1');
        expect(out.passRate).toBe(100);
    });

    it('no PASS → passRate 0', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([
            { result: 'FAIL', _count: { _all: 3 } },
            { result: 'INCONCLUSIVE', _count: { _all: 1 } },
        ]);
        const out = await getControlEffectiveness(ctx, 'c-1');
        expect(out.passRate).toBe(0);
    });

    it('rounds the percentage to the nearest integer', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([
            { result: 'PASS', _count: { _all: 2 } },
            { result: 'FAIL', _count: { _all: 1 } },
        ]);
        const out = await getControlEffectiveness(ctx, 'c-1');
        // 2/3 = 66.66… → 67
        expect(out.passRate).toBe(67);
    });

    it('respects the windowDays option (custom value surfaces in result)', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([]);
        const out = await getControlEffectiveness(ctx, 'c-1', { windowDays: 30 });
        expect(out.windowDays).toBe(30);
        // The cutoff in the query is also derived from windowDays.
        const call = tenantDb.controlTestRun.groupBy.mock.calls[0][0];
        const cutoff = call.where.executedAt.gte as Date;
        const expected30 = new Date();
        expected30.setDate(expected30.getDate() - 30);
        const drift30 = Math.abs(cutoff.getTime() - expected30.getTime());
        expect(drift30).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it('queries only COMPLETED runs for this tenant + control', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([]);
        await getControlEffectiveness(ctx, 'ctrl-X');
        const call = tenantDb.controlTestRun.groupBy.mock.calls[0][0];
        expect(call.where.status).toBe('COMPLETED');
        expect(call.where.tenantId).toBe('tenant-1');
        expect(call.where.controlId).toBe('ctrl-X');
    });

    it('default window is 90 days', async () => {
        tenantDb.controlTestRun.groupBy.mockResolvedValueOnce([]);
        const out = await getControlEffectiveness(ctx, 'c-1');
        expect(out.windowDays).toBe(90);
    });
});
