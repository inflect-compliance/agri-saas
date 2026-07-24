/**
 * Plan-vs-actual crop loop — DB-backed end-to-end integration test.
 *
 * The loop that was severed, now proven whole against a real database:
 *
 *   1. Generate builds the succession board — Planting rows + the
 *      auto-generated SOW/HARVEST field tasks linked to each planting.
 *   2. Recording a sow as a journal entry LINKED to a planting
 *      (`plantingLinks`) writes the LogPlanting row (the ACTUAL), surfaces
 *      it in `getCropPlanProgress` (the date the board's CircleCheck
 *      renders from), and advances the Planting status PLANNED → SOWN.
 *   3. Re-running Generate is SAFE — keyed on the stable
 *      (cropPlanId, successionNumber) identity, it UPSERTS rather than
 *      delete-and-recreates: the recorded actual survives (same planting
 *      id, LogPlanting intact, status still SOWN) and NO duplicate tasks
 *      are created.
 *
 * Exercises the real usecases (createCropPlan → generatePlantings →
 * createLogEntry → getCropPlanProgress) so every layer — schema
 * threading, the journal write path, status advancement, and the
 * regenerate reconcile — is on the hook. Skipped when DB is unavailable.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createCropPlan, generatePlantings, getCropPlanProgress } from '@/app-layer/usecases/crop-planning';
import { createLogEntry } from '@/app-layer/usecases/journal';

const globalPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DB_URL }),
});
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `cploop-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;

let USER_ID = '';
let SEASON_ID = '';
let CROP_TYPE_ID = '';
let VARIETY_ID = '';

function ctx() {
    return makeRequestContext(Role.ADMIN, { userId: USER_ID, tenantId: TENANT_ID, tenantSlug: TAG });
}

/** All PLANTING task links for the plan's plantings — the auto tasks. */
async function plantingLinkCount(cropPlanId: string): Promise<number> {
    const plantings = await globalPrisma.planting.findMany({
        where: { tenantId: TENANT_ID, cropPlanId },
        select: { id: true },
    });
    return globalPrisma.taskLink.count({
        where: {
            tenantId: TENANT_ID,
            entityType: 'PLANTING',
            entityId: { in: plantings.map((p) => p.id) },
        },
    });
}

async function seed() {
    await globalPrisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: { id: TENANT_ID, name: `t ${TAG}`, slug: TAG },
    });
    const email = `${TAG}@example.test`;
    const user = await globalPrisma.user.create({
        data: { email, emailHash: hashForLookup(email) },
    });
    USER_ID = user.id;
    await globalPrisma.tenantMembership.create({
        data: {
            tenantId: TENANT_ID,
            userId: USER_ID,
            role: Role.ADMIN,
            status: MembershipStatus.ACTIVE,
        },
    });

    const season = await globalPrisma.season.create({
        data: {
            tenantId: TENANT_ID,
            name: 'Loop season',
            startDate: new Date('2026-03-01T00:00:00Z'),
            endDate: new Date('2026-10-01T00:00:00Z'),
        },
    });
    SEASON_ID = season.id;
    const cropType = await globalPrisma.cropType.create({
        data: { tenantId: TENANT_ID, name: 'Radish' },
    });
    CROP_TYPE_ID = cropType.id;
    // A direct-sow variety WITH days-to-maturity — the minimum the engine
    // needs to produce a dated schedule.
    const variety = await globalPrisma.cropVariety.create({
        data: {
            tenantId: TENANT_ID,
            cropTypeId: CROP_TYPE_ID,
            name: 'Cherry Belle',
            defaultMethod: 'DIRECT_SOW',
            daysToMaturity: 28,
            harvestWindowDays: 10,
        },
    });
    VARIETY_ID = variety.id;
}

async function teardown() {
    // Children → parents. Scoped to this suite's tagged tenant so the
    // cleanup is parallel-safe.
    await globalPrisma.logPlanting.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.logEntry.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.taskLink.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.task.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.taskKeySequence.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.automationExecution.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.notification.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.planting.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.cropPlan.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.cropVariety.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.cropType.deleteMany({ where: { tenantId: TENANT_ID } });
    await globalPrisma.season.deleteMany({ where: { tenantId: TENANT_ID } });
    // AuditLog carries a hash-chain trigger — disable FK/trigger replication
    // for the scoped delete (same pattern as the other usecase suites).
    await globalPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
        await tx.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "tenantId" = $1`, TENANT_ID);
    });
    await globalPrisma.tenantMembership.deleteMany({ where: { tenantId: TENANT_ID } });
    if (USER_ID) await globalPrisma.user.deleteMany({ where: { id: USER_ID } });
    await globalPrisma.tenant.deleteMany({ where: { id: TENANT_ID } });
}

describeFn('plan-vs-actual crop loop (DB)', () => {
    beforeAll(async () => {
        await globalPrisma.$connect();
        await seed();
    });
    afterAll(async () => {
        await teardown();
        await globalPrisma.$disconnect();
    });

    it('records an actual, advances status, and survives re-Generate with zero duplicate tasks', async () => {
        // ── 1. Create the plan + generate the succession board ──
        const plan = await createCropPlan(ctx(), {
            seasonId: SEASON_ID,
            cropTypeId: CROP_TYPE_ID,
            cropVarietyId: VARIETY_ID,
            name: 'Radish successions',
            method: 'DIRECT_SOW',
            firstSowDate: '2026-04-01T00:00:00Z',
            successions: 2,
            intervalDays: 14,
            plantsPerSuccession: 50,
        });

        const gen1 = await generatePlantings(ctx(), plan.id);
        expect(gen1.plantingsGenerated).toBe(2);
        // DIRECT_SOW ⇒ SOW + HARVEST per planting × 2 successions = 4 tasks.
        expect(gen1.tasksCreated).toBe(4);
        expect(await plantingLinkCount(plan.id)).toBe(4);

        // Grab succession 1 — the one we'll sow.
        const succ1Before = await globalPrisma.planting.findFirstOrThrow({
            where: { tenantId: TENANT_ID, cropPlanId: plan.id, successionNumber: 1 },
            select: { id: true, status: true },
        });
        expect(succ1Before.status).toBe('PLANNED');

        // ── 2. Record the sow as a journal entry linked to the planting ──
        const OCCURRED = '2026-04-03T00:00:00.000Z';
        await createLogEntry(ctx(), {
            type: 'SEEDING',
            title: 'Sowed succession 1',
            status: 'DONE',
            occurredAt: OCCURRED,
            plantingLinks: [{ plantingId: succ1Before.id, stage: 'SOW' }],
        });

        // The LogPlanting (the actual) exists…
        const logPlantings = await globalPrisma.logPlanting.findMany({
            where: { tenantId: TENANT_ID, plantingId: succ1Before.id, stage: 'SOW' },
        });
        expect(logPlantings).toHaveLength(1);

        // …the planting status advanced PLANNED → SOWN…
        const succ1AfterSow = await globalPrisma.planting.findUniqueOrThrow({
            where: { id: succ1Before.id },
            select: { status: true },
        });
        expect(succ1AfterSow.status).toBe('SOWN');

        // …and getCropPlanProgress surfaces the actual (what the board's
        // CircleCheck renders from).
        const progress1 = await getCropPlanProgress(ctx(), plan.id);
        const row1 = progress1.find((r) => r.plantingId === succ1Before.id);
        expect(row1?.actual.SOW).toBe(OCCURRED);
        expect(row1?.status).toBe('SOWN');

        // ── 3. Re-Generate must preserve the actual + create no duplicates ──
        const gen2 = await generatePlantings(ctx(), plan.id);
        expect(gen2.plantingsGenerated).toBe(2);
        // Every stage task already exists → nothing new.
        expect(gen2.tasksCreated).toBe(0);

        // Same planting id — the row was upserted, not delete-and-recreated.
        const succ1After = await globalPrisma.planting.findFirstOrThrow({
            where: { tenantId: TENANT_ID, cropPlanId: plan.id, successionNumber: 1 },
            select: { id: true, status: true },
        });
        expect(succ1After.id).toBe(succ1Before.id);
        expect(succ1After.status).toBe('SOWN'); // status preserved

        // The recorded actual survived the regenerate…
        const logPlantingsAfter = await globalPrisma.logPlanting.findMany({
            where: { tenantId: TENANT_ID, plantingId: succ1Before.id, stage: 'SOW' },
        });
        expect(logPlantingsAfter).toHaveLength(1);

        // …and is still visible in the progress view.
        const progress2 = await getCropPlanProgress(ctx(), plan.id);
        expect(progress2.find((r) => r.plantingId === succ1Before.id)?.actual.SOW).toBe(OCCURRED);

        // ZERO duplicate tasks — the link count is unchanged.
        expect(await plantingLinkCount(plan.id)).toBe(4);
        // Still exactly 2 plantings (no phantom second succession-1).
        const plantingCount = await globalPrisma.planting.count({
            where: { tenantId: TENANT_ID, cropPlanId: plan.id },
        });
        expect(plantingCount).toBe(2);
    });
});
