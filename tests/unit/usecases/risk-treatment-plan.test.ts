/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks +
 * fakeDb shims mirror runtime Prisma contracts; per-line typing has
 * poor cost/benefit in test files (codebase convention — see
 * tests/unit/usecases/control-test.test.ts). */
/**
 * Unit tests for src/app-layer/usecases/risk-treatment-plan.ts
 *
 * Epic G-7 — Risk Treatment Plan lifecycle. The usecase is a
 * branch-dense state machine; the highest-risk paths are:
 *
 *   - RBAC tiers: create/addMilestone/changeStrategy/completeMilestone
 *     need WRITE; completePlan needs ADMIN. A mix-up lets an EDITOR
 *     close a plan + flip a Risk to CLOSED.
 *   - createTreatmentPlan's "targetDate in the future" guard.
 *   - addMilestone's DRAFT → ACTIVE auto-transition (idempotent —
 *     only flips when markActiveFromDraft reports count > 0).
 *   - changeStrategy's same-strategy no-op rejection + COMPLETED
 *     immutability.
 *   - completeMilestone's already-complete + already-COMPLETED-plan
 *     guards.
 *   - completePlan's "every milestone complete" gate (a regression
 *     here silently closes a plan with open work) AND the
 *     strategy → RiskStatus mapping (MITIGATE/TRANSFER/AVOID → CLOSED,
 *     ACCEPT → ACCEPTED) — the wrong mapping mis-states a risk's
 *     posture in the register.
 *   - The concurrent-transition race (repo count 0 → 400).
 */

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(),
}));

jest.mock('@/app-layer/repositories/RiskTreatmentPlanRepository', () => ({
    RiskTreatmentPlanRepository: {
        list: jest.fn(),
        getById: jest.fn(),
        create: jest.fn(),
        markCompleted: jest.fn(),
        markActiveFromDraft: jest.fn(),
        updateStrategy: jest.fn(),
        countMilestones: jest.fn(),
        addMilestone: jest.fn(),
        getMilestone: jest.fn(),
        markMilestoneCompleted: jest.fn(),
        findOverdue: jest.fn(),
    },
}));

jest.mock('@/app-layer/events/audit', () => ({
    logEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/security/sanitize', () => ({
    sanitizePlainText: jest.fn((s: string) => `SANITISED(${s})`),
}));

import {
    createTreatmentPlan,
    addMilestone,
    changeStrategy,
    completeMilestone,
    completePlan,
    getOverduePlans,
    getTreatmentPlan,
    transferTreatmentPlanOwnership,
} from '@/app-layer/usecases/risk-treatment-plan';
import { RiskTreatmentPlanRepository } from '@/app-layer/repositories/RiskTreatmentPlanRepository';
import { runInTenantContext } from '@/lib/db-context';
import { logEvent } from '@/app-layer/events/audit';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { makeRequestContext } from '../../helpers/make-context';

const mockRunInTx = runInTenantContext as jest.MockedFunction<typeof runInTenantContext>;
const mockRepo = RiskTreatmentPlanRepository as jest.Mocked<typeof RiskTreatmentPlanRepository>;
const mockLog = logEvent as jest.MockedFunction<typeof logEvent>;
const mockSanitize = sanitizePlainText as jest.MockedFunction<typeof sanitizePlainText>;

const FUTURE = new Date(Date.now() + 30 * 86400000);
const PAST = new Date(Date.now() - 86400000);

beforeEach(() => {
    jest.clearAllMocks();
    mockSanitize.mockImplementation((s: any) => `SANITISED(${s})`);
});

function fakeDb(overrides: Record<string, any> = {}) {
    return {
        risk: {
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            update: jest.fn(),
        },
        // Audit S1 — `transferTreatmentPlanOwnership` calls `update`.
        riskTreatmentPlan: { findFirst: jest.fn(), update: jest.fn() },
        ...overrides,
    };
}

describe('getTreatmentPlan — read gate', () => {
    it('rejects a caller without read permission', async () => {
        const ctx = makeRequestContext('READER', {
            permissions: {
                canRead: false,
                canWrite: false,
                canAdmin: false,
                canAudit: false,
                canExport: false,
            },
        });
        await expect(getTreatmentPlan(ctx, 'p-1')).rejects.toThrow(/permission/i);
    });

    it('throws notFound when the plan does not exist', async () => {
        mockRepo.getById.mockResolvedValueOnce(null as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));
        await expect(
            getTreatmentPlan(makeRequestContext('EDITOR'), 'p-missing'),
        ).rejects.toThrow(/not found/i);
    });
});

describe('createTreatmentPlan', () => {
    it('rejects a caller without write permission', async () => {
        await expect(
            createTreatmentPlan(makeRequestContext('READER'), {
                riskId: 'r1',
                strategy: 'MITIGATE',
                ownerUserId: 'u1',
                targetDate: FUTURE,
            }),
        ).rejects.toThrow(/permission/i);
    });

    it('rejects a targetDate in the past before any DB work', async () => {
        await expect(
            createTreatmentPlan(makeRequestContext('EDITOR'), {
                riskId: 'r1',
                strategy: 'MITIGATE',
                ownerUserId: 'u1',
                targetDate: PAST,
            }),
        ).rejects.toThrow(/targetDate must be in the future/i);
        expect(mockRunInTx).not.toHaveBeenCalled();
    });

    it('rejects malformed input (zod) — bad strategy enum', async () => {
        await expect(
            createTreatmentPlan(makeRequestContext('EDITOR'), {
                riskId: 'r1',
                strategy: 'NONSENSE',
                ownerUserId: 'u1',
                targetDate: FUTURE,
            }),
        ).rejects.toThrow();
    });

    it('throws notFound when the risk is not in the tenant', async () => {
        const db = fakeDb();
        db.risk.findFirst.mockResolvedValueOnce(null);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            createTreatmentPlan(makeRequestContext('EDITOR'), {
                riskId: 'r-foreign',
                strategy: 'MITIGATE',
                ownerUserId: 'u1',
                targetDate: FUTURE,
            }),
        ).rejects.toThrow(/risk not found/i);
        expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('creates a plan and emits an entity_lifecycle audit event', async () => {
        const db = fakeDb();
        db.risk.findFirst.mockResolvedValueOnce({ id: 'r1', title: 'Data leak' });
        mockRepo.create.mockResolvedValueOnce({ id: 'plan-new' } as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await createTreatmentPlan(makeRequestContext('EDITOR'), {
            riskId: 'r1',
            strategy: 'ACCEPT',
            ownerUserId: 'u1',
            targetDate: FUTURE,
        });

        expect(result).toEqual({ treatmentPlanId: 'plan-new' });
        const logArg = mockLog.mock.calls[0][2] as any;
        expect(logArg.action).toBe('TREATMENT_PLAN_CREATED');
        expect(logArg.detailsJson.category).toBe('entity_lifecycle');
    });
});

describe('addMilestone — append + DRAFT→ACTIVE auto-transition', () => {
    it('rejects a caller without write permission', async () => {
        await expect(
            addMilestone(makeRequestContext('READER'), 'plan-1', {
                title: 'M1',
                dueDate: FUTURE,
            }),
        ).rejects.toThrow(/permission/i);
    });

    it('throws notFound when the plan is absent', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce(null);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            addMilestone(makeRequestContext('EDITOR'), 'plan-x', {
                title: 'M1',
                dueDate: FUTURE,
            }),
        ).rejects.toThrow(/treatment plan not found/i);
    });

    it('refuses to add a milestone to a COMPLETED plan', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            status: 'COMPLETED',
            riskId: 'r1',
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            addMilestone(makeRequestContext('EDITOR'), 'plan-1', {
                title: 'M1',
                dueDate: FUTURE,
            }),
        ).rejects.toThrow(/cannot add a milestone to a COMPLETED plan/i);
        expect(mockRepo.addMilestone).not.toHaveBeenCalled();
    });

    it('appends with computed sortOrder when none is supplied and sanitises title + description', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            status: 'ACTIVE',
            riskId: 'r1',
        });
        mockRepo.countMilestones.mockResolvedValueOnce(3 as never);
        mockRepo.addMilestone.mockResolvedValueOnce({ id: 'm-new', title: 'SANITISED(M)' } as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await addMilestone(makeRequestContext('EDITOR'), 'plan-1', {
            title: '<b>M</b>',
            description: '<i>desc</i>',
            dueDate: FUTURE,
        });

        // append → sortOrder = countMilestones() result (3)
        expect(result.sortOrder).toBe(3);
        const addArgs = mockRepo.addMilestone.mock.calls[0][2] as any;
        expect(addArgs.title).toBe('SANITISED(<b>M</b>)');
        expect(addArgs.description).toBe('SANITISED(<i>desc</i>)');
        // ACTIVE plan → no auto-transition attempt.
        expect(mockRepo.markActiveFromDraft).not.toHaveBeenCalled();
    });

    it('honours an explicit sortOrder and leaves description null when omitted', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            status: 'ACTIVE',
            riskId: 'r1',
        });
        mockRepo.addMilestone.mockResolvedValueOnce({ id: 'm-new', title: 'SANITISED(M)' } as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await addMilestone(makeRequestContext('EDITOR'), 'plan-1', {
            title: 'M',
            dueDate: FUTURE,
            sortOrder: 9,
        });

        expect(result.sortOrder).toBe(9);
        // explicit sortOrder → countMilestones never queried
        expect(mockRepo.countMilestones).not.toHaveBeenCalled();
        const addArgs = mockRepo.addMilestone.mock.calls[0][2] as any;
        expect(addArgs.description).toBeNull();
    });

    it('auto-activates a DRAFT plan on first milestone add and emits TREATMENT_PLAN_ACTIVATED', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            status: 'DRAFT',
            riskId: 'r1',
        });
        mockRepo.countMilestones.mockResolvedValueOnce(0 as never);
        mockRepo.addMilestone.mockResolvedValueOnce({ id: 'm-1', title: 'SANITISED(M)' } as never);
        mockRepo.markActiveFromDraft.mockResolvedValueOnce(1 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await addMilestone(makeRequestContext('EDITOR'), 'plan-1', {
            title: 'M',
            dueDate: FUTURE,
        });

        expect(mockRepo.markActiveFromDraft).toHaveBeenCalledTimes(1);
        const actions = mockLog.mock.calls.map((c) => (c[2] as any).action);
        expect(actions).toContain('TREATMENT_MILESTONE_ADDED');
        expect(actions).toContain('TREATMENT_PLAN_ACTIVATED');
    });

    it('does NOT emit TREATMENT_PLAN_ACTIVATED when markActiveFromDraft reports zero rows (idempotent race)', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            status: 'DRAFT',
            riskId: 'r1',
        });
        mockRepo.countMilestones.mockResolvedValueOnce(0 as never);
        mockRepo.addMilestone.mockResolvedValueOnce({ id: 'm-1', title: 'SANITISED(M)' } as never);
        // another writer already flipped DRAFT → ACTIVE
        mockRepo.markActiveFromDraft.mockResolvedValueOnce(0 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await addMilestone(makeRequestContext('EDITOR'), 'plan-1', {
            title: 'M',
            dueDate: FUTURE,
        });

        const actions = mockLog.mock.calls.map((c) => (c[2] as any).action);
        expect(actions).not.toContain('TREATMENT_PLAN_ACTIVATED');
    });
});

describe('changeStrategy', () => {
    it('rejects a caller without write permission', async () => {
        await expect(
            changeStrategy(makeRequestContext('READER'), 'plan-1', {
                strategy: 'ACCEPT',
                reason: 'why',
            }),
        ).rejects.toThrow(/permission/i);
    });

    it('throws notFound when the plan is absent', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce(null);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            changeStrategy(makeRequestContext('EDITOR'), 'plan-x', {
                strategy: 'ACCEPT',
                reason: 'why',
            }),
        ).rejects.toThrow(/treatment plan not found/i);
    });

    it('refuses to change strategy on a COMPLETED plan', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            strategy: 'MITIGATE',
            status: 'COMPLETED',
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            changeStrategy(makeRequestContext('EDITOR'), 'plan-1', {
                strategy: 'ACCEPT',
                reason: 'why',
            }),
        ).rejects.toThrow(/cannot change strategy on a COMPLETED plan/i);
    });

    it('rejects a no-op change to the same strategy', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            strategy: 'MITIGATE',
            status: 'ACTIVE',
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            changeStrategy(makeRequestContext('EDITOR'), 'plan-1', {
                strategy: 'MITIGATE',
                reason: 'why',
            }),
        ).rejects.toThrow(/already MITIGATE/i);
        expect(mockRepo.updateStrategy).not.toHaveBeenCalled();
    });

    it('surfaces a 400 when the repo reports a concurrent transition (count 0)', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            strategy: 'MITIGATE',
            status: 'ACTIVE',
        });
        mockRepo.updateStrategy.mockResolvedValueOnce(0 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            changeStrategy(makeRequestContext('EDITOR'), 'plan-1', {
                strategy: 'ACCEPT',
                reason: 'why',
            }),
        ).rejects.toThrow(/changed concurrently/i);
    });

    it('changes the strategy and emits a status_change audit event with the sanitised reason', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            strategy: 'MITIGATE',
            status: 'ACTIVE',
        });
        mockRepo.updateStrategy.mockResolvedValueOnce(1 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await changeStrategy(makeRequestContext('EDITOR'), 'plan-1', {
            strategy: 'ACCEPT',
            reason: '<b>risk owner signed off</b>',
        });

        expect(result).toEqual({
            treatmentPlanId: 'plan-1',
            fromStrategy: 'MITIGATE',
            toStrategy: 'ACCEPT',
        });
        const logArg = mockLog.mock.calls[0][2] as any;
        expect(logArg.action).toBe('TREATMENT_PLAN_STRATEGY_CHANGED');
        expect(logArg.detailsJson.reason).toBe('SANITISED(<b>risk owner signed off</b>)');
    });
});

describe('completeMilestone', () => {
    it('rejects a caller without write permission', async () => {
        await expect(
            completeMilestone(makeRequestContext('READER'), 'm-1', {}),
        ).rejects.toThrow(/permission/i);
    });

    it('throws notFound when the milestone is absent', async () => {
        mockRepo.getMilestone.mockResolvedValueOnce(null as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        await expect(
            completeMilestone(makeRequestContext('EDITOR'), 'm-x', {}),
        ).rejects.toThrow(/milestone not found/i);
    });

    it('throws notFound when the parent plan is soft-deleted', async () => {
        mockRepo.getMilestone.mockResolvedValueOnce({
            id: 'm-1',
            completedAt: null,
            evidence: null,
            treatmentPlan: { id: 'plan-1', status: 'ACTIVE', deletedAt: new Date() },
        } as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        await expect(
            completeMilestone(makeRequestContext('EDITOR'), 'm-1', {}),
        ).rejects.toThrow(/treatment plan not found/i);
    });

    it('rejects re-completing an already-complete milestone', async () => {
        mockRepo.getMilestone.mockResolvedValueOnce({
            id: 'm-1',
            completedAt: new Date(),
            evidence: null,
            treatmentPlan: { id: 'plan-1', status: 'ACTIVE', deletedAt: null },
        } as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        await expect(
            completeMilestone(makeRequestContext('EDITOR'), 'm-1', {}),
        ).rejects.toThrow(/already complete/i);
    });

    it('rejects completing a milestone on a COMPLETED plan', async () => {
        mockRepo.getMilestone.mockResolvedValueOnce({
            id: 'm-1',
            completedAt: null,
            evidence: null,
            treatmentPlan: { id: 'plan-1', status: 'COMPLETED', deletedAt: null },
        } as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        await expect(
            completeMilestone(makeRequestContext('EDITOR'), 'm-1', {}),
        ).rejects.toThrow(/cannot complete a milestone on a COMPLETED plan/i);
    });

    it('surfaces a 400 on a concurrent-transition race (count 0)', async () => {
        mockRepo.getMilestone.mockResolvedValueOnce({
            id: 'm-1',
            completedAt: null,
            evidence: null,
            treatmentPlan: { id: 'plan-1', status: 'ACTIVE', deletedAt: null },
        } as never);
        mockRepo.markMilestoneCompleted.mockResolvedValueOnce(0 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        await expect(
            completeMilestone(makeRequestContext('EDITOR'), 'm-1', {}),
        ).rejects.toThrow(/changed concurrently/i);
    });

    it('completes the milestone and emits a status_change audit event', async () => {
        mockRepo.getMilestone.mockResolvedValueOnce({
            id: 'm-1',
            completedAt: null,
            evidence: null,
            treatmentPlan: { id: 'plan-1', status: 'ACTIVE', deletedAt: null },
        } as never);
        mockRepo.markMilestoneCompleted.mockResolvedValueOnce(1 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        const result = await completeMilestone(makeRequestContext('EDITOR'), 'm-1', {
            evidence: 'https://example.com/proof',
        });

        expect(result.milestoneId).toBe('m-1');
        expect(result.completedAt).toBeInstanceOf(Date);
        const logArg = mockLog.mock.calls[0][2] as any;
        expect(logArg.action).toBe('TREATMENT_MILESTONE_COMPLETED');
        expect(logArg.detailsJson.toStatus).toBe('completed');
    });
});

describe('completePlan — ADMIN-gated close + strategy→RiskStatus mapping', () => {
    it('rejects an EDITOR (write but not admin)', async () => {
        await expect(
            completePlan(makeRequestContext('EDITOR'), 'plan-1', { closingRemark: 'done' }),
        ).rejects.toThrow(/permission/i);
        expect(mockRunInTx).not.toHaveBeenCalled();
    });

    it('throws notFound when the plan is absent', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce(null);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            completePlan(makeRequestContext('ADMIN'), 'plan-x', { closingRemark: 'done' }),
        ).rejects.toThrow(/treatment plan not found/i);
    });

    it('rejects completing an already-COMPLETED plan', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy: 'MITIGATE',
            status: 'COMPLETED',
            milestones: [],
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'done' }),
        ).rejects.toThrow(/already complete/i);
    });

    it('refuses to complete a plan that still has incomplete milestones', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy: 'MITIGATE',
            status: 'ACTIVE',
            milestones: [
                { id: 'm-1', completedAt: new Date() },
                { id: 'm-2', completedAt: null }, // still open
            ],
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'done' }),
        ).rejects.toThrow(/1 incomplete milestone/i);
        expect(mockRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('surfaces a 400 on a concurrent-transition race (count 0)', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy: 'MITIGATE',
            status: 'ACTIVE',
            milestones: [],
        });
        mockRepo.markCompleted.mockResolvedValueOnce(0 as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        await expect(
            completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'done' }),
        ).rejects.toThrow(/changed concurrently/i);
    });

    it('completes a MITIGATE plan and flips the linked risk to MITIGATED (Audit S1)', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy: 'MITIGATE',
            status: 'ACTIVE',
            milestones: [{ id: 'm-1', completedAt: new Date() }],
        });
        mockRepo.markCompleted.mockResolvedValueOnce(1 as never);
        // Audit S1 — risk read now includes `score` + `residualScore`
        // for the residual computation.
        db.risk.findUniqueOrThrow.mockResolvedValueOnce({
            status: 'MITIGATING',
            score: 20,
            residualScore: null,
        });
        db.risk.update.mockResolvedValueOnce({});
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await completePlan(makeRequestContext('ADMIN'), 'plan-1', {
            closingRemark: 'mitigation complete',
        });

        // Audit S1 — MITIGATE no longer collapses into CLOSED; the new
        // `MITIGATED` value distinguishes "controls implemented, residual
        // accepted" from "risk eliminated".
        expect(result.newRiskStatus).toBe('MITIGATED');
        // Audit S1 — residual score = floor(20 / 5) = 4. Written
        // alongside the status update, with `residualScoreSetAt` timestamp.
        expect(db.risk.update).toHaveBeenCalledWith({
            where: { id: 'r1' },
            data: {
                status: 'MITIGATED',
                residualScore: 4,
                residualScoreSetAt: expect.any(Date),
            },
        });
        const actions = mockLog.mock.calls.map((c) => (c[2] as any).action);
        expect(actions).toContain('RISK_STATUS_CHANGED_BY_TREATMENT_PLAN');
        expect(actions).toContain('TREATMENT_PLAN_COMPLETED');
        // The status-change audit row carries the residual score
        // pair so an auditor can reconstruct the before/after.
        const statusEvent = mockLog.mock.calls
            .map((c) => c[2] as any)
            .find((e) => e.action === 'RISK_STATUS_CHANGED_BY_TREATMENT_PLAN');
        expect(statusEvent.detailsJson.after.residualScore).toBe(4);
        expect(statusEvent.detailsJson.after.residualScoreBefore).toBeNull();
        expect(statusEvent.detailsJson.after.inheritedScore).toBe(20);
    });

    it('completes an ACCEPT plan and flips the linked risk to ACCEPTED', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy: 'ACCEPT',
            status: 'ACTIVE',
            milestones: [],
        });
        mockRepo.markCompleted.mockResolvedValueOnce(1 as never);
        // Audit S1 — risk read includes `score` (used for residual)
        // and `residualScore` (compared to avoid a no-op update).
        db.risk.findUniqueOrThrow.mockResolvedValueOnce({
            status: 'OPEN',
            score: 15,
            residualScore: null,
        });
        db.risk.update.mockResolvedValueOnce({});
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await completePlan(makeRequestContext('ADMIN'), 'plan-1', {
            closingRemark: 'formally accepted',
        });

        // ACCEPT → ACCEPTED unchanged; residual = score (no controls).
        expect(result.newRiskStatus).toBe('ACCEPTED');
        expect(db.risk.update).toHaveBeenCalledWith({
            where: { id: 'r1' },
            data: {
                status: 'ACCEPTED',
                residualScore: 15,
                residualScoreSetAt: expect.any(Date),
            },
        });
    });

    it('does NOT update the risk (or emit a risk status_change) when status AND residual unchanged', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy: 'TRANSFER',
            status: 'ACTIVE',
            milestones: [],
        });
        mockRepo.markCompleted.mockResolvedValueOnce(1 as never);
        // TRANSFER → CLOSED, residual = floor(8/10) = 0; the risk is
        // ALREADY CLOSED with residualScore = 0. No-op.
        db.risk.findUniqueOrThrow.mockResolvedValueOnce({
            status: 'CLOSED',
            score: 8,
            residualScore: 0,
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await completePlan(makeRequestContext('ADMIN'), 'plan-1', {
            closingRemark: 'transferred to insurer',
        });

        expect(result.newRiskStatus).toBe('CLOSED');
        expect(db.risk.update).not.toHaveBeenCalled();
        const actions = mockLog.mock.calls.map((c) => (c[2] as any).action);
        expect(actions).not.toContain('RISK_STATUS_CHANGED_BY_TREATMENT_PLAN');
        expect(actions).toContain('TREATMENT_PLAN_COMPLETED');
    });
});

describe('getOverduePlans', () => {
    it('rejects a caller without read permission', async () => {
        const ctx = makeRequestContext('READER', {
            permissions: {
                canRead: false,
                canWrite: false,
                canAdmin: false,
                canAudit: false,
                canExport: false,
            },
        });
        await expect(getOverduePlans(ctx)).rejects.toThrow(/permission/i);
    });

    it('maps repository rows, falling back to null riskTitle when the join is absent', async () => {
        const target = new Date(Date.now() - 5 * 86400000);
        mockRepo.findOverdue.mockResolvedValueOnce([
            {
                id: 'plan-1',
                tenantId: 'tenant-1',
                riskId: 'r1',
                strategy: 'MITIGATE',
                ownerUserId: 'u1',
                targetDate: target,
                status: 'OVERDUE',
                risk: { title: 'Vendor breach' },
            },
            {
                id: 'plan-2',
                tenantId: 'tenant-1',
                riskId: 'r2',
                strategy: 'ACCEPT',
                ownerUserId: 'u2',
                targetDate: target,
                status: 'ACTIVE',
                risk: null,
            },
        ] as never);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn({} as never));

        const rows = await getOverduePlans(makeRequestContext('EDITOR'));

        expect(rows).toHaveLength(2);
        expect(rows[0].riskTitle).toBe('Vendor breach');
        expect(rows[1].riskTitle).toBeNull();
    });
});

// ─── Audit S1 (2026-05-22) — residual score on completion ──────────

describe('completePlan — residual score (Audit S1)', () => {
    function setup(strategy: 'MITIGATE' | 'ACCEPT' | 'TRANSFER' | 'AVOID', score: number, existingResidual: number | null = null) {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            riskId: 'r1',
            strategy,
            status: 'ACTIVE',
            milestones: [],
        });
        mockRepo.markCompleted.mockResolvedValueOnce(1 as never);
        db.risk.findUniqueOrThrow.mockResolvedValueOnce({
            status: 'MITIGATING',
            score,
            residualScore: existingResidual,
        });
        db.risk.update.mockResolvedValueOnce({});
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));
        return db;
    }

    it('MITIGATE strategy → residual = floor(score / 5), floor at 1', async () => {
        const db = setup('MITIGATE', 25);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'done' });
        // 25 / 5 = 5
        expect(db.risk.update.mock.calls[0][0].data.residualScore).toBe(5);
    });

    it('MITIGATE with very low score (1) → residual floor at 1 (never zero for MITIGATE)', async () => {
        const db = setup('MITIGATE', 1);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'done' });
        // floor(1/5) = 0, but Math.max(1, ...) = 1
        expect(db.risk.update.mock.calls[0][0].data.residualScore).toBe(1);
    });

    it('ACCEPT strategy → residual = score (no controls, no reduction)', async () => {
        const db = setup('ACCEPT', 15);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'accepted' });
        expect(db.risk.update.mock.calls[0][0].data.residualScore).toBe(15);
    });

    it('TRANSFER strategy → residual = floor(score / 10), can be 0', async () => {
        const db = setup('TRANSFER', 25);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'insured' });
        expect(db.risk.update.mock.calls[0][0].data.residualScore).toBe(2);
    });

    it('AVOID strategy → residual = 0 (activity gone)', async () => {
        const db = setup('AVOID', 30);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'eliminated' });
        expect(db.risk.update.mock.calls[0][0].data.residualScore).toBe(0);
    });

    it('residual write carries `residualScoreSetAt` timestamp', async () => {
        const db = setup('MITIGATE', 20);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'done' });
        expect(db.risk.update.mock.calls[0][0].data.residualScoreSetAt).toBeInstanceOf(Date);
    });

    it('emits the residual-pair (before/after) in the status-change audit row', async () => {
        setup('MITIGATE', 20, 8 /* prior residual from an earlier plan */);
        await completePlan(makeRequestContext('ADMIN'), 'plan-1', { closingRemark: 'second pass' });
        const statusEvent = mockLog.mock.calls
            .map((c) => c[2] as any)
            .find((e) => e.action === 'RISK_STATUS_CHANGED_BY_TREATMENT_PLAN');
        expect(statusEvent.detailsJson.after.residualScore).toBe(4);
        expect(statusEvent.detailsJson.after.residualScoreBefore).toBe(8);
        expect(statusEvent.detailsJson.after.inheritedScore).toBe(20);
    });
});

// ─── Audit S1 — transferTreatmentPlanOwnership ─────────────────────

describe('transferTreatmentPlanOwnership (Audit S1)', () => {
    it('rejects READER (assertCanWrite)', async () => {
        await expect(
            transferTreatmentPlanOwnership(makeRequestContext('READER'), 'plan-1', {
                newOwnerUserId: 'u2',
                reason: 'handover',
            }),
        ).rejects.toThrow();
    });

    it('throws notFound when the plan is missing', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce(null);
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));
        await expect(
            transferTreatmentPlanOwnership(makeRequestContext('EDITOR'), 'plan-x', {
                newOwnerUserId: 'u2',
                reason: 'sabbatical',
            }),
        ).rejects.toThrow(/not found/i);
    });

    it('refuses to transfer a COMPLETED plan', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            ownerUserId: 'u1',
            status: 'COMPLETED',
            riskId: 'r1',
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));
        await expect(
            transferTreatmentPlanOwnership(makeRequestContext('EDITOR'), 'plan-1', {
                newOwnerUserId: 'u2',
                reason: 'restructure',
            }),
        ).rejects.toThrow(/completed plan/i);
    });

    it('refuses a no-op transfer to the SAME owner', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            ownerUserId: 'u1',
            status: 'ACTIVE',
            riskId: 'r1',
        });
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));
        await expect(
            transferTreatmentPlanOwnership(makeRequestContext('EDITOR'), 'plan-1', {
                newOwnerUserId: 'u1',
                reason: 'oops',
            }),
        ).rejects.toThrow(/current owner/i);
    });

    it('happy path: updates ownerUserId + emits TREATMENT_PLAN_OWNERSHIP_TRANSFERRED with from/to/reason', async () => {
        const db = fakeDb();
        db.riskTreatmentPlan.findFirst.mockResolvedValueOnce({
            id: 'plan-1',
            ownerUserId: 'u1',
            status: 'ACTIVE',
            riskId: 'r1',
        });
        db.riskTreatmentPlan.update.mockResolvedValueOnce({});
        mockRunInTx.mockImplementationOnce(async (_ctx, fn) => fn(db as never));

        const result = await transferTreatmentPlanOwnership(
            makeRequestContext('EDITOR'),
            'plan-1',
            { newOwnerUserId: 'u2', reason: 'sabbatical handover' },
        );

        expect(result).toEqual({
            treatmentPlanId: 'plan-1',
            previousOwnerUserId: 'u1',
            newOwnerUserId: 'u2',
        });
        expect(db.riskTreatmentPlan.update).toHaveBeenCalledWith({
            where: { id: 'plan-1' },
            data: { ownerUserId: 'u2' },
        });
        const event = mockLog.mock.calls
            .map((c) => c[2] as any)
            .find((e) => e.action === 'TREATMENT_PLAN_OWNERSHIP_TRANSFERRED');
        expect(event).toBeDefined();
        expect(event.detailsJson.category).toBe('access');
        expect(event.detailsJson.before.ownerUserId).toBe('u1');
        expect(event.detailsJson.after.ownerUserId).toBe('u2');
        expect(event.detailsJson.after.riskId).toBe('r1');
        // `sanitizePlainText` is mocked to wrap the input in
        // `SANITISED(...)` — confirms the usecase routes the reason
        // through the sanitiser before audit.
        expect(event.detailsJson.after.reason).toBe('SANITISED(sabbatical handover)');
    });

    it('rejects empty reason via schema validation', async () => {
        await expect(
            transferTreatmentPlanOwnership(makeRequestContext('EDITOR'), 'plan-1', {
                newOwnerUserId: 'u2',
                reason: '',
            }),
        ).rejects.toThrow();
    });
});
