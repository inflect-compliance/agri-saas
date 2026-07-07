/* eslint-disable @typescript-eslint/no-explicit-any -- standard
 * test-mock pattern; per-line typing has poor cost/benefit ratio. */

/**
 * Unit tests for `src/app-layer/usecases/crop-planning.ts` — the
 * integration layer over the pure succession engine.
 *
 * Covers:
 *   - generatePlantings: wires the REAL engine (generateSuccessions)
 *     → persists N Planting rows (createMany) → fans out field tasks
 *     via createTask + addTaskLink('PLANTING', …); is idempotent
 *     (deletes only PLANNED rows; skips a stage whose task already
 *     exists).
 *   - getCropPlanProgress: maps planned dates beside the actuals from
 *     LogPlanting → LogEntry.occurredAt, grouped by stage, in ONE pass.
 *   - read/write authorization gating.
 *
 * The succession engine is NOT mocked — its output is deterministic, so
 * the test asserts the usecase persisted exactly what the engine
 * computes (the integration contract). createTask / addTaskLink ARE
 * mocked (they open their own context + enqueue).
 */

const mockDb = {
    cropPlan: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    planting: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    taskLink: { findMany: jest.fn() },
    logPlanting: { findMany: jest.fn() },
    season: { findFirst: jest.fn(), create: jest.fn() },
    cropType: { findFirst: jest.fn() },
    cropVariety: { findFirst: jest.fn() },
} as any;

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

jest.mock('@/app-layer/events/audit', () => ({
    logEvent: jest.fn(),
}));

jest.mock('@/lib/security/sanitize', () => ({
    sanitizePlainText: jest.fn((s: string) => s),
}));

const createTask = jest.fn();
const addTaskLink = jest.fn();
const listTaskLinks = jest.fn();
jest.mock('@/app-layer/usecases/task', () => ({
    createTask: (...args: any[]) => createTask(...args),
    addTaskLink: (...args: any[]) => addTaskLink(...args),
    listTaskLinks: (...args: any[]) => listTaskLinks(...args),
}));

import { logEvent } from '@/app-layer/events/audit';
import {
    generatePlantings,
    getCropPlanProgress,
    listCropPlans,
    createCropPlan,
} from '@/app-layer/usecases/crop-planning';
import { generateSuccessions } from '@/lib/planning/succession';
import { makeRequestContext } from '../helpers/make-context';

const editorCtx = makeRequestContext('EDITOR', { userId: 'user-editor', tenantId: 'tenant-1' });
const readerCtx = makeRequestContext('READER', { tenantId: 'tenant-1' });

/** A lettuce-shaped variety with TRANSPLANT timing + full spacing. */
const lettuceVariety = {
    id: 'var-1',
    name: 'Leaf Lettuce',
    defaultMethod: 'TRANSPLANT',
    daysToTransplant: 28,
    daysToMaturity: 45,
    harvestWindowDays: 14,
    inRowSpacingCm: { toString: () => '25' },
    betweenRowSpacingCm: { toString: () => '30' },
    seedsPerGram: { toString: () => '800' },
    germinationRate: { toString: () => '0.85' },
    seedsPerCell: 1,
};

const basePlan = {
    id: 'plan-1',
    tenantId: 'tenant-1',
    name: 'Summer lettuce',
    method: 'TRANSPLANT' as const,
    firstSowDate: new Date('2026-04-01T00:00:00Z'),
    successions: 3,
    intervalDays: 14,
    plantsPerSuccession: 60,
    bedLengthM: null,
    rowsPerBed: null,
    targetAreaM2: null,
    cropPlanId: undefined,
    cropVarietyId: 'var-1',
    locationId: 'loc-1',
    parcelId: 'parcel-1',
    cropType: { id: 'ct-1', name: 'Lettuce' },
    variety: lettuceVariety,
};

let createdPlantings: any[];

beforeEach(() => {
    jest.clearAllMocks();
    createdPlantings = [];
    createTask.mockResolvedValue({ id: 'task-new' });
    addTaskLink.mockResolvedValue({ id: 'link-new' });

    // findFirst returns the plan with its variety joined.
    mockDb.cropPlan.findFirst.mockResolvedValue(basePlan);
    mockDb.planting.deleteMany.mockResolvedValue({ count: 0 });
    // createMany records what would be persisted; the re-read returns the
    // same rows with synthetic ids so the task fan-out can run.
    mockDb.planting.createMany.mockImplementation(async ({ data }: any) => {
        createdPlantings = data.map((d: any, i: number) => ({ ...d, id: `planting-${i + 1}` }));
        return { count: data.length };
    });
    mockDb.planting.findMany.mockImplementation(async () => createdPlantings);
    // No pre-existing PLANTING task links by default (fresh fan-out).
    mockDb.taskLink.findMany.mockResolvedValue([]);
    mockDb.logPlanting.findMany.mockResolvedValue([]);
});

// ─── generatePlantings — engine → plantings → tasks ─────────────────

describe('generatePlantings', () => {
    it('runs the engine and persists exactly the computed plantings', async () => {
        const result = await generatePlantings(editorCtx, 'plan-1');

        // The usecase deletes only PLANNED rows before re-creating.
        expect(mockDb.planting.deleteMany).toHaveBeenCalledWith({
            where: { tenantId: 'tenant-1', cropPlanId: 'plan-1', status: 'PLANNED' },
        });

        // It persisted N = successions rows.
        expect(mockDb.planting.createMany).toHaveBeenCalledTimes(1);
        const persisted = mockDb.planting.createMany.mock.calls[0][0].data;
        expect(persisted).toHaveLength(3);

        // And those rows match what the PURE engine computes from the
        // same inputs — the integration contract.
        const expected = generateSuccessions(
            { firstSowDate: basePlan.firstSowDate, successions: 3, intervalDays: 14 },
            { method: 'TRANSPLANT', daysToTransplant: 28, daysToMaturity: 45, harvestWindowDays: 14 },
            { plantsPerSuccession: 60, bedLengthM: null, rowsPerBed: null, areaM2: null },
            {
                inRowSpacingCm: 25,
                betweenRowSpacingCm: 30,
                seedsPerGram: 800,
                germinationRate: 0.85,
                seedsPerCell: 1,
            },
        );
        expect(persisted[0].sowDate).toEqual(expected[0].sowDate);
        expect(persisted[0].harvestStartDate).toEqual(expected[0].harvestStartDate);
        expect(persisted[1].sowDate).toEqual(expected[1].sowDate);
        expect(persisted[0].plantCount).toBe(expected[0].plantCount);
        expect(persisted[0].seedQuantityGrams).toBe(expected[0].seedQuantityGrams);
        // Carries the plan's variety + location + parcel onto each planting.
        expect(persisted[0].cropVarietyId).toBe('var-1');
        expect(persisted[0].locationId).toBe('loc-1');
        expect(persisted[0].parcelId).toBe('parcel-1');

        expect(result.plantingsGenerated).toBe(3);
    });

    it('fans out SOW + TRANSPLANT + HARVEST tasks per planting, linked to PLANTING', async () => {
        const result = await generatePlantings(editorCtx, 'plan-1');

        // TRANSPLANT method ⇒ 3 stages × 3 successions = 9 tasks.
        expect(createTask).toHaveBeenCalledTimes(9);
        expect(addTaskLink).toHaveBeenCalledTimes(9);
        expect(result.tasksCreated).toBe(9);

        // Every link is a PLANTING link to a created planting id.
        for (const call of addTaskLink.mock.calls) {
            expect(call[2]).toBe('PLANTING');
            expect(call[3]).toMatch(/^planting-\d+$/);
        }

        // Tasks carry the FARM_TASK type + the stage tag for idempotency.
        const stages = createTask.mock.calls.map((c) => c[1].metadataJson.plantingStage);
        expect(stages.filter((s) => s === 'SOW')).toHaveLength(3);
        expect(stages.filter((s) => s === 'TRANSPLANT')).toHaveLength(3);
        expect(stages.filter((s) => s === 'HARVEST')).toHaveLength(3);
        expect(createTask.mock.calls[0][1].type).toBe('FARM_TASK');
    });

    it('omits the TRANSPLANT task for a DIRECT_SOW plan', async () => {
        mockDb.cropPlan.findFirst.mockResolvedValue({
            ...basePlan,
            method: 'DIRECT_SOW',
            variety: { ...lettuceVariety, defaultMethod: 'DIRECT_SOW', daysToTransplant: null },
        });

        const result = await generatePlantings(editorCtx, 'plan-1');

        // 2 stages (SOW + HARVEST) × 3 successions = 6 tasks.
        expect(createTask).toHaveBeenCalledTimes(6);
        expect(result.tasksCreated).toBe(6);
        const stages = createTask.mock.calls.map((c) => c[1].metadataJson.plantingStage);
        expect(stages).not.toContain('TRANSPLANT');
        // Direct-sow plantings carry no transplant date.
        const persisted = mockDb.planting.createMany.mock.calls[0][0].data;
        expect(persisted[0].transplantDate).toBeNull();
    });

    it('is idempotent — skips a stage whose PLANTING task already exists', async () => {
        // Pre-existing SOW task on planting-1 (a prior fan-out).
        mockDb.taskLink.findMany.mockResolvedValue([
            { entityId: 'planting-1', task: { metadataJson: { plantingStage: 'SOW' } } },
        ]);

        const result = await generatePlantings(editorCtx, 'plan-1');

        // 9 stages minus the 1 already-present SOW = 8 created.
        expect(createTask).toHaveBeenCalledTimes(8);
        expect(result.tasksCreated).toBe(8);
        // The skipped one is planting-1's SOW.
        const made = createTask.mock.calls.map(
            (c, i) => `${addTaskLink.mock.calls[i][3]}:${c[1].metadataJson.plantingStage}`,
        );
        expect(made).not.toContain('planting-1:SOW');
    });

    it('reads the idempotency set in ONE batched taskLink query (no N+1)', async () => {
        await generatePlantings(editorCtx, 'plan-1');
        // The whole idempotency check is a single findMany with an `in`.
        expect(mockDb.taskLink.findMany).toHaveBeenCalledTimes(1);
        const where = mockDb.taskLink.findMany.mock.calls[0][0].where;
        expect(where.entityType).toBe('PLANTING');
        expect(where.entityId.in).toEqual(['planting-1', 'planting-2', 'planting-3']);
    });

    it('writes a generation audit event', async () => {
        await generatePlantings(editorCtx, 'plan-1');
        expect(logEvent).toHaveBeenCalledWith(
            mockDb,
            editorCtx,
            expect.objectContaining({
                action: 'CROP_PLAN_PLANTINGS_GENERATED',
                entityType: 'CropPlan',
                detailsJson: expect.objectContaining({ category: 'entity_lifecycle' }),
            }),
        );
    });

    it('throws if the plan has no maturity-bearing variety', async () => {
        mockDb.cropPlan.findFirst.mockResolvedValue({ ...basePlan, variety: null });
        await expect(generatePlantings(editorCtx, 'plan-1')).rejects.toThrow(/CROP_PLAN_NOT_READY/);
        expect(mockDb.planting.createMany).not.toHaveBeenCalled();
        expect(createTask).not.toHaveBeenCalled();
    });

    it('throws notFound for a missing plan', async () => {
        mockDb.cropPlan.findFirst.mockResolvedValue(null);
        await expect(generatePlantings(editorCtx, 'nope')).rejects.toThrow(/not found/i);
    });

    it('refuses a reader (write gate)', async () => {
        await expect(generatePlantings(readerCtx, 'plan-1')).rejects.toThrow();
        expect(mockDb.cropPlan.findFirst).not.toHaveBeenCalled();
    });
});

// ─── getCropPlanProgress — plan-vs-actual mapping ───────────────────

describe('getCropPlanProgress', () => {
    const plantings = [
        {
            id: 'planting-1',
            successionNumber: 1,
            method: 'TRANSPLANT',
            status: 'SOWN',
            sowDate: new Date('2026-04-01T00:00:00Z'),
            transplantDate: new Date('2026-04-29T00:00:00Z'),
            harvestStartDate: new Date('2026-06-13T00:00:00Z'),
            harvestEndDate: new Date('2026-06-27T00:00:00Z'),
        },
        {
            id: 'planting-2',
            successionNumber: 2,
            method: 'TRANSPLANT',
            status: 'PLANNED',
            sowDate: new Date('2026-04-15T00:00:00Z'),
            transplantDate: new Date('2026-05-13T00:00:00Z'),
            harvestStartDate: new Date('2026-06-27T00:00:00Z'),
            harvestEndDate: new Date('2026-07-11T00:00:00Z'),
        },
    ];

    beforeEach(() => {
        mockDb.cropPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
        mockDb.planting.findMany.mockResolvedValue(plantings);
    });

    it('maps planned dates beside the actuals from LogPlanting (one query)', async () => {
        // planting-1 was actually sown a day late (2026-04-02).
        mockDb.logPlanting.findMany.mockResolvedValue([
            { plantingId: 'planting-1', stage: 'SOW', logEntry: { occurredAt: new Date('2026-04-02T00:00:00Z') } },
        ]);

        const rows = await getCropPlanProgress(readerCtx, 'plan-1');

        // ONE query for all actuals — no N+1.
        expect(mockDb.logPlanting.findMany).toHaveBeenCalledTimes(1);
        expect(mockDb.logPlanting.findMany.mock.calls[0][0].where.plantingId.in).toEqual([
            'planting-1',
            'planting-2',
        ]);

        expect(rows).toHaveLength(2);
        expect(rows[0].planned.sowDate).toBe('2026-04-01T00:00:00.000Z');
        expect(rows[0].actual.SOW).toBe('2026-04-02T00:00:00.000Z');
        // No actual transplant/harvest recorded yet.
        expect(rows[0].actual.TRANSPLANT).toBeNull();
        // planting-2 has no actuals at all.
        expect(rows[1].actual).toEqual({ SOW: null, TRANSPLANT: null, HARVEST: null });
    });

    it('keeps the EARLIEST actual when a stage has multiple log entries', async () => {
        mockDb.logPlanting.findMany.mockResolvedValue([
            { plantingId: 'planting-1', stage: 'HARVEST', logEntry: { occurredAt: new Date('2026-06-20T00:00:00Z') } },
            { plantingId: 'planting-1', stage: 'HARVEST', logEntry: { occurredAt: new Date('2026-06-14T00:00:00Z') } },
        ]);
        const rows = await getCropPlanProgress(readerCtx, 'plan-1');
        expect(rows[0].actual.HARVEST).toBe('2026-06-14T00:00:00.000Z');
    });

    it('throws notFound for a missing plan', async () => {
        mockDb.cropPlan.findFirst.mockResolvedValue(null);
        await expect(getCropPlanProgress(readerCtx, 'nope')).rejects.toThrow(/not found/i);
    });
});

// ─── read/write gating on the CRUD surface ──────────────────────────

describe('crop-plan CRUD gating', () => {
    it('listCropPlans is allowed for a reader and forwards filters', async () => {
        mockDb.cropPlan.findMany.mockResolvedValue([{ id: 'plan-1' }]);
        const rows = await listCropPlans(readerCtx, { seasonId: 's-1' });
        expect(rows).toEqual([{ id: 'plan-1' }]);
        const where = mockDb.cropPlan.findMany.mock.calls[0][0].where;
        expect(where.seasonId).toBe('s-1');
        expect(where.tenantId).toBe('tenant-1');
    });

    it('createCropPlan refuses a reader', async () => {
        await expect(
            createCropPlan(readerCtx, {
                seasonId: 's-1',
                cropTypeId: 'ct-1',
                name: 'X',
                firstSowDate: '2026-04-01T00:00:00Z',
            }),
        ).rejects.toThrow();
    });

    it('createCropPlan validates the season + crop type belong to the tenant', async () => {
        mockDb.season.findFirst.mockResolvedValue(null);
        await expect(
            createCropPlan(editorCtx, {
                seasonId: 'foreign',
                cropTypeId: 'ct-1',
                name: 'X',
                firstSowDate: '2026-04-01T00:00:00Z',
            }),
        ).rejects.toThrow(/season/i);
    });
});
