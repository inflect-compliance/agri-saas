/* eslint-disable @typescript-eslint/no-explicit-any -- standard
 * test-mock pattern; per-line typing has poor cost/benefit ratio. */

/**
 * Unit tests for `src/app-layer/usecases/due-planning.ts`.
 *
 * Roadmap Q3 — Work items adjacency. Tests the test-plan due queue,
 * the idempotent due-planning sweep, the dashboard metrics
 * aggregation, and the cross-control plan listing.
 *
 * Covers:
 *   - getDueQueue — isOverdue + hasPendingRun derivations.
 *   - runDuePlanning — idempotency (skip plans with pending runs),
 *     PLANNED run creation, DUE_PLANNING_EXECUTED audit shape.
 *   - getTestDashboardMetrics — completion/pass/fail/evidence rate
 *     math + zero-division safety + repeated-failure threshold
 *     (≥2) + Unknown name fallback.
 *   - listAllTestPlans — filter shape (status / controlId / due
 *     overdue / due next7d / q text search).
 */

const mockDb = {
    controlTestPlan: { findMany: jest.fn(), count: jest.fn() },
    controlTestRun: { create: jest.fn(), findMany: jest.fn() },
    control: { findMany: jest.fn() },
} as any;

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/events/audit', () => ({
    logEvent: jest.fn(),
}));

import { logEvent } from '@/app-layer/events/audit';
import {
    getDueQueue,
    runDuePlanning,
    getTestDashboardMetrics,
    listAllTestPlans,
} from '@/app-layer/usecases/due-planning';
import { makeRequestContext } from '../helpers/make-context';

beforeEach(() => {
    jest.clearAllMocks();
});

const adminCtx = makeRequestContext('ADMIN');
const editorCtx = makeRequestContext('EDITOR');
const readerCtx = makeRequestContext('READER');

// ─── getDueQueue ──────────────────────────────────────────────────

describe('getDueQueue', () => {
    it('derives isOverdue from nextDueAt vs now', async () => {
        const past = new Date(Date.now() - 86400000);
        const future = new Date(Date.now() + 86400000);
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([
            { id: 'p-1', nextDueAt: past, runs: [] },
            { id: 'p-2', nextDueAt: future, runs: [] },
            { id: 'p-3', nextDueAt: null, runs: [] },
        ]);

        const queue = await getDueQueue(readerCtx);

        expect(queue[0].isOverdue).toBe(true);
        expect(queue[1].isOverdue).toBe(false);
        expect(queue[2].isOverdue).toBe(false); // null nextDueAt → not overdue
    });

    it('derives hasPendingRun from the runs array length', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([
            { id: 'p-1', nextDueAt: new Date(), runs: [{ id: 'r-1', status: 'PLANNED' }] },
            { id: 'p-2', nextDueAt: new Date(), runs: [] },
        ]);

        const queue = await getDueQueue(readerCtx);

        expect(queue[0].hasPendingRun).toBe(true);
        expect(queue[1].hasPendingRun).toBe(false);
    });

    it('orders by nextDueAt ascending (soonest first) — verified by passing through repo query', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await getDueQueue(readerCtx);
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.orderBy).toEqual({ nextDueAt: 'asc' });
    });

    it('filters out AD_HOC plans (not on a cadence)', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await getDueQueue(readerCtx);
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.where.frequency).toEqual({ not: 'AD_HOC' });
    });
});

// ─── runDuePlanning ────────────────────────────────────────────────

describe('runDuePlanning — idempotency', () => {
    it('creates PLANNED runs only for plans without existing pending runs', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([
            { id: 'p-1', controlId: 'c-1', runs: [{ id: 'r-existing' }] }, // already pending
            { id: 'p-2', controlId: 'c-2', runs: [] },                      // needs run
        ]);
        (mockDb.controlTestRun.create as jest.Mock).mockResolvedValueOnce({ id: 'r-new' });

        const res = await runDuePlanning(editorCtx);

        expect(res.checked).toBe(2);
        expect(res.alreadyPending).toBe(1);
        expect(res.created).toBe(1);
        expect(res.runIds).toEqual(['r-new']);
        expect(mockDb.controlTestRun.create).toHaveBeenCalledTimes(1);
        const runCreateArgs = (mockDb.controlTestRun.create as jest.Mock).mock.calls[0][0].data;
        expect(runCreateArgs.controlId).toBe('c-2');
        expect(runCreateArgs.status).toBe('PLANNED');
    });

    it('emits DUE_PLANNING_EXECUTED audit', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await runDuePlanning(editorCtx);
        const payload = (logEvent as jest.Mock).mock.calls[0][2];
        expect(payload.action).toBe('DUE_PLANNING_EXECUTED');
        expect(payload.detailsJson.event).toBe('due_planning_executed');
    });

    it('returns zero counts on idle (no due plans)', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        const res = await runDuePlanning(editorCtx);
        expect(res).toEqual({ checked: 0, alreadyPending: 0, created: 0, runIds: [] });
    });

    it('rejects READER (manage-test-plans gate)', async () => {
        await expect(runDuePlanning(readerCtx)).rejects.toBeDefined();
        expect(mockDb.controlTestPlan.findMany).not.toHaveBeenCalled();
    });
});

// ─── getTestDashboardMetrics ──────────────────────────────────────

describe('getTestDashboardMetrics', () => {
    it('computes completion / pass / fail / evidence rates with the right rounding', async () => {
        (mockDb.controlTestRun.findMany as jest.Mock).mockResolvedValue([
            { id: 'r-1', status: 'COMPLETED', result: 'PASS', controlId: 'c-1', evidence: [{ id: 'e-1' }] },
            { id: 'r-2', status: 'COMPLETED', result: 'PASS', controlId: 'c-1', evidence: [] },
            { id: 'r-3', status: 'COMPLETED', result: 'FAIL', controlId: 'c-2', evidence: [{ id: 'e-2' }] },
            { id: 'r-4', status: 'RUNNING', result: null, controlId: 'c-3', evidence: [] },
        ]);
        (mockDb.controlTestPlan.count as jest.Mock)
            .mockResolvedValueOnce(2)  // overdue
            .mockResolvedValueOnce(10); // totalPlans

        const m = await getTestDashboardMetrics(readerCtx);

        expect(m.totalRuns).toBe(4);
        expect(m.completedRuns).toBe(3);
        expect(m.passRuns).toBe(2);
        expect(m.failRuns).toBe(1);
        expect(m.completionRate).toBe(75); // 3/4
        expect(m.passRate).toBe(67);       // 2/3 rounded
        expect(m.failRate).toBe(33);
        expect(m.evidenceRate).toBe(67);   // 2/3 completed runs have evidence
        expect(m.overduePlans).toBe(2);
        expect(m.totalPlans).toBe(10);
    });

    it('returns zero rates when no runs exist (no division by zero)', async () => {
        (mockDb.controlTestRun.findMany as jest.Mock).mockResolvedValue([]);
        (mockDb.controlTestPlan.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

        const m = await getTestDashboardMetrics(readerCtx);

        expect(m.completionRate).toBe(0);
        expect(m.passRate).toBe(0);
        expect(m.failRate).toBe(0);
        expect(m.evidenceRate).toBe(0);
    });

    it('flags controls with ≥2 FAIL runs as repeatedFailures', async () => {
        (mockDb.controlTestRun.findMany as jest.Mock).mockResolvedValue([
            { id: 'r-1', status: 'COMPLETED', result: 'FAIL', controlId: 'c-flaky', evidence: [] },
            { id: 'r-2', status: 'COMPLETED', result: 'FAIL', controlId: 'c-flaky', evidence: [] },
            { id: 'r-3', status: 'COMPLETED', result: 'FAIL', controlId: 'c-once', evidence: [] }, // single fail, NOT repeated
        ]);
        (mockDb.controlTestPlan.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        (mockDb.control.findMany as jest.Mock).mockResolvedValue([
            { id: 'c-flaky', name: 'Backup', code: 'A.8.13' },
        ]);

        const m = await getTestDashboardMetrics(readerCtx);

        expect(m.repeatedFailures).toEqual([
            { controlId: 'c-flaky', controlName: 'Backup', controlCode: 'A.8.13', failCount: 2 },
        ]);
    });

    it('falls back to Unknown name when control is missing from lookup', async () => {
        (mockDb.controlTestRun.findMany as jest.Mock).mockResolvedValue([
            { id: 'r-1', status: 'COMPLETED', result: 'FAIL', controlId: 'c-orphan', evidence: [] },
            { id: 'r-2', status: 'COMPLETED', result: 'FAIL', controlId: 'c-orphan', evidence: [] },
        ]);
        (mockDb.controlTestPlan.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        (mockDb.control.findMany as jest.Mock).mockResolvedValue([]);

        const m = await getTestDashboardMetrics(readerCtx);

        expect(m.repeatedFailures[0].controlName).toBe('Unknown');
    });

    it('honours custom periodDays parameter', async () => {
        (mockDb.controlTestRun.findMany as jest.Mock).mockResolvedValue([]);
        (mockDb.controlTestPlan.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        const before = Date.now();

        const m = await getTestDashboardMetrics(readerCtx, 7);

        expect(m.periodDays).toBe(7);
        const findManyArgs = (mockDb.controlTestRun.findMany as jest.Mock).mock.calls[0][0];
        const periodStart = findManyArgs.where.createdAt.gte as Date;
        const delta = before - periodStart.getTime();
        const sevenDays = 7 * 86_400_000;
        expect(delta).toBeGreaterThan(sevenDays - 5_000);
        expect(delta).toBeLessThan(sevenDays + 5_000);
    });
});

// ─── listAllTestPlans ──────────────────────────────────────────────

describe('listAllTestPlans — filter shape', () => {
    it('applies status filter when supplied', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await listAllTestPlans(readerCtx, { status: 'ACTIVE' });
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.where.status).toBe('ACTIVE');
    });

    it('applies controlId filter when supplied', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await listAllTestPlans(readerCtx, { controlId: 'c-1' });
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.where.controlId).toBe('c-1');
    });

    it('applies due=overdue (nextDueAt < now)', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await listAllTestPlans(readerCtx, { due: 'overdue' });
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.where.nextDueAt).toMatchObject({ lt: expect.any(Date) });
    });

    it('applies due=next7d (nextDueAt between now and now+7d)', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await listAllTestPlans(readerCtx, { due: 'next7d' });
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.where.nextDueAt).toMatchObject({ gte: expect.any(Date), lte: expect.any(Date) });
    });

    it('applies q text search to name (case-insensitive)', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([]);
        await listAllTestPlans(readerCtx, { q: 'backup' });
        const args = (mockDb.controlTestPlan.findMany as jest.Mock).mock.calls[0][0];
        expect(args.where.name).toEqual({ contains: 'backup', mode: 'insensitive' });
    });

    it('passes through with no filters when called bare', async () => {
        (mockDb.controlTestPlan.findMany as jest.Mock).mockResolvedValue([{ id: 'p-1' }]);
        const rows = await listAllTestPlans(readerCtx);
        expect(rows).toEqual([{ id: 'p-1' }]);
    });
});
// reference to keep import live in case future refactor drops it
void adminCtx;
