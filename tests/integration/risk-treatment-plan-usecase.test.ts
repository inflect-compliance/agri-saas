/**
 * Epic G-7 — usecase-layer integration tests.
 *
 * Coverage
 * --------
 *   1. createTreatmentPlan happy path + audit + cross-tenant risk
 *      rejection + past-targetDate rejection + permission gate.
 *   2. addMilestone — sortOrder appends; explicit sortOrder honoured.
 *   3. addMilestone rejected on COMPLETED plans.
 *   4. completeMilestone happy path + double-complete rejected.
 *   5. completePlan — refuses when any milestone is incomplete.
 *   6. completePlan happy path + risk-status mapping per strategy.
 *   7. completePlan with zero milestones (ACCEPT-strategy fast path).
 *   8. completePlan idempotency — re-complete rejected.
 *   9. getOverduePlans returns only non-completed past-targetDate
 *      plans, ordered by targetDate ASC.
 *  10. Audit chain — create → milestone → milestone-complete →
 *      plan-complete → risk-status emits the canonical sequence.
 */

import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import {
    createTreatmentPlan,
    addMilestone,
    completeMilestone,
    completePlan,
    getOverduePlans,
    getTreatmentPlan,
    listTreatmentPlans,
} from '@/app-layer/usecases/risk-treatment-plan';

const globalPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DB_URL }),
});
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUITE_TAG = `g7u-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${SUITE_TAG}`;
const FOREIGN_TENANT_ID = `t-${SUITE_TAG}-other`;

let admin: { userId: string };
let editor: { userId: string };
let reader: { userId: string };
let foreignAdmin: { userId: string };
let RISK_ID = '';
let FOREIGN_RISK_ID = '';

async function makeUser(label: string): Promise<{ userId: string }> {
    const email = `${SUITE_TAG}-${label}@example.test`;
    const u = await globalPrisma.user.create({
        data: { email, emailHash: hashForLookup(email) },
    });
    return { userId: u.id };
}

async function seed() {
    await globalPrisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: { id: TENANT_ID, name: `t ${SUITE_TAG}`, slug: SUITE_TAG },
    });
    await globalPrisma.tenant.upsert({
        where: { id: FOREIGN_TENANT_ID },
        update: {},
        create: {
            id: FOREIGN_TENANT_ID,
            name: `t ${SUITE_TAG} other`,
            slug: `${SUITE_TAG}-other`,
        },
    });
    admin = await makeUser('admin');
    editor = await makeUser('editor');
    reader = await makeUser('reader');
    foreignAdmin = await makeUser('foreign');
    await globalPrisma.tenantMembership.createMany({
        data: [
            { tenantId: TENANT_ID, userId: admin.userId, role: Role.ADMIN, status: MembershipStatus.ACTIVE },
            { tenantId: TENANT_ID, userId: editor.userId, role: Role.EDITOR, status: MembershipStatus.ACTIVE },
            { tenantId: TENANT_ID, userId: reader.userId, role: Role.READER, status: MembershipStatus.ACTIVE },
            { tenantId: FOREIGN_TENANT_ID, userId: foreignAdmin.userId, role: Role.ADMIN, status: MembershipStatus.ACTIVE },
        ],
    });
    const r = await globalPrisma.risk.create({
        data: { tenantId: TENANT_ID, title: 'Affected risk', status: 'OPEN' },
    });
    RISK_ID = r.id;
    const fr = await globalPrisma.risk.create({
        data: { tenantId: FOREIGN_TENANT_ID, title: 'Foreign risk' },
    });
    FOREIGN_RISK_ID = fr.id;
}

async function teardown() {
    const tenantIds = [TENANT_ID, FOREIGN_TENANT_ID];
    await globalPrisma.treatmentMilestone.deleteMany({
        where: { tenantId: { in: tenantIds } },
    });
    await globalPrisma.riskTreatmentPlan.deleteMany({
        where: { tenantId: { in: tenantIds } },
    });
    await globalPrisma.risk.deleteMany({
        where: { tenantId: { in: tenantIds } },
    });
    await globalPrisma.tenantMembership.deleteMany({
        where: { tenantId: { in: tenantIds } },
    });
    await globalPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
            `SET LOCAL session_replication_role = 'replica'`,
        );
        await tx.$executeRawUnsafe(
            `DELETE FROM "AuditLog" WHERE "tenantId" = ANY($1::text[])`,
            tenantIds,
        );
    });
    const userIds = [admin, editor, reader, foreignAdmin]
        .filter(Boolean)
        .map((u) => u.userId);
    if (userIds.length > 0) {
        await globalPrisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await globalPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

function ctxAs(role: Role, userId: string, tenantId = TENANT_ID) {
    return makeRequestContext(role, { userId, tenantId });
}

const futureDate = (days: number) =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000);
const pastDate = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describeFn('Epic G-7 — risk treatment plan usecases', () => {
    beforeAll(async () => {
        await seed();
    });
    afterAll(async () => {
        await teardown();
        await globalPrisma.$disconnect();
    });
    afterEach(async () => {
        await globalPrisma.treatmentMilestone.deleteMany({
            where: { tenantId: { in: [TENANT_ID, FOREIGN_TENANT_ID] } },
        });
        await globalPrisma.riskTreatmentPlan.deleteMany({
            where: { tenantId: { in: [TENANT_ID, FOREIGN_TENANT_ID] } },
        });
        // Reset risk status so fresh runs see OPEN.
        await globalPrisma.risk.update({
            where: { id: RISK_ID },
            data: { status: 'OPEN' },
        });
        await globalPrisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
                `SET LOCAL session_replication_role = 'replica'`,
            );
            await tx.$executeRawUnsafe(
                `DELETE FROM "AuditLog" WHERE "tenantId" = $1`,
                TENANT_ID,
            );
        });
    });

    // ── 1. createTreatmentPlan ─────────────────────────────────────

    it('createTreatmentPlan creates DRAFT row + emits audit', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(90),
            },
        );
        const plan = await getTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            treatmentPlanId,
        );
        expect(plan.status).toBe('DRAFT');
        expect(plan.strategy).toBe('MITIGATE');
        expect(plan.riskId).toBe(RISK_ID);
        const audit = await globalPrisma.auditLog.findMany({
            where: {
                tenantId: TENANT_ID,
                action: 'TREATMENT_PLAN_CREATED',
            },
        });
        expect(audit).toHaveLength(1);
    });

    it('createTreatmentPlan rejects targetDate in the past', async () => {
        await expect(
            createTreatmentPlan(ctxAs(Role.ADMIN, admin.userId), {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: pastDate(1),
            }),
        ).rejects.toThrow(/in the future/i);
    });

    it('createTreatmentPlan rejects cross-tenant risk', async () => {
        await expect(
            createTreatmentPlan(ctxAs(Role.ADMIN, admin.userId), {
                riskId: FOREIGN_RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(60),
            }),
        ).rejects.toThrow(/Risk not found/i);
    });

    it('createTreatmentPlan requires write permission', async () => {
        await expect(
            createTreatmentPlan(ctxAs(Role.READER, reader.userId), {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(60),
            }),
        ).rejects.toThrow(/permission/i);
    });

    // ── 2. addMilestone — sortOrder ────────────────────────────────

    it('addMilestone appends sortOrder by default; explicit sortOrder honoured', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(90),
            },
        );
        const m1 = await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'first', dueDate: futureDate(30) },
        );
        const m2 = await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'second', dueDate: futureDate(60) },
        );
        const m3 = await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'inserted-up-front', dueDate: futureDate(15), sortOrder: 0 },
        );
        expect(m1.sortOrder).toBe(0);
        expect(m2.sortOrder).toBe(1);
        expect(m3.sortOrder).toBe(0); // explicit
        const all = await globalPrisma.treatmentMilestone.findMany({
            where: { treatmentPlanId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, sortOrder: true },
        });
        expect(all.find((x) => x.id === m1.milestoneId)?.sortOrder).toBe(0);
        expect(all.find((x) => x.id === m2.milestoneId)?.sortOrder).toBe(1);
        expect(all.find((x) => x.id === m3.milestoneId)?.sortOrder).toBe(0);
    });

    // ── 3. addMilestone rejected on COMPLETED ──────────────────────

    it('addMilestone rejects when plan is COMPLETED', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'ACCEPT',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
            closingRemark: 'no milestones needed for acceptance',
        });
        await expect(
            addMilestone(ctxAs(Role.EDITOR, editor.userId), treatmentPlanId, {
                title: 'too late',
                dueDate: futureDate(45),
            }),
        ).rejects.toThrow(/COMPLETED/i);
    });

    // ── 4. completeMilestone ───────────────────────────────────────

    it('completeMilestone marks one milestone done; double-complete rejected', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(90),
            },
        );
        const { milestoneId } = await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'm1', dueDate: futureDate(30) },
        );
        await completeMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            milestoneId,
            { evidence: 'evidence-link-or-id' },
        );
        const m = await globalPrisma.treatmentMilestone.findUniqueOrThrow({
            where: { id: milestoneId },
        });
        expect(m.completedAt).toBeInstanceOf(Date);
        expect(m.completedByUserId).toBe(editor.userId);
        expect(m.evidence).toBe('evidence-link-or-id');

        await expect(
            completeMilestone(
                ctxAs(Role.EDITOR, editor.userId),
                milestoneId,
                {},
            ),
        ).rejects.toThrow(/already complete/i);
    });

    // ── 5. completePlan refuses incomplete milestones ──────────────

    it('completePlan refuses when any milestone is incomplete', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(90),
            },
        );
        await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'incomplete', dueDate: futureDate(30) },
        );
        await expect(
            completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
                closingRemark: 'nope',
            }),
        ).rejects.toThrow(/incomplete milestone/i);
    });

    // ── 6. completePlan happy path + risk-status mapping ───────────

    it('MITIGATE plan completion → risk goes to MITIGATED + residual score written (Audit S1)', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(90),
            },
        );
        const { milestoneId } = await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'm', dueDate: futureDate(30) },
        );
        await completeMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            milestoneId,
            {},
        );
        const r = await completePlan(
            ctxAs(Role.ADMIN, admin.userId),
            treatmentPlanId,
            { closingRemark: 'all good' },
        );
        // Audit S1 — MITIGATE no longer collapses into CLOSED.
        expect(r.newRiskStatus).toBe('MITIGATED');
        const risk = await globalPrisma.risk.findUniqueOrThrow({
            where: { id: RISK_ID },
        });
        expect(risk.status).toBe('MITIGATED');
        // Residual score = floor(risk.score / 5), minimum 1.
        expect(risk.residualScore).not.toBeNull();
        expect(risk.residualScore).toBeGreaterThanOrEqual(1);
        expect(risk.residualScore).toBeLessThanOrEqual(
            Math.max(1, Math.floor(risk.score / 5)),
        );
        expect(risk.residualScoreSetAt).not.toBeNull();
    });

    it('ACCEPT plan completion → risk goes to ACCEPTED', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'ACCEPT',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
            closingRemark: 'risk formally accepted',
        });
        const risk = await globalPrisma.risk.findUniqueOrThrow({
            where: { id: RISK_ID },
        });
        expect(risk.status).toBe('ACCEPTED');
    });

    it('TRANSFER plan completion → risk goes to CLOSED', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'TRANSFER',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
            closingRemark: 'transferred to insurer',
        });
        const risk = await globalPrisma.risk.findUniqueOrThrow({
            where: { id: RISK_ID },
        });
        expect(risk.status).toBe('CLOSED');
    });

    it('AVOID plan completion → risk goes to CLOSED', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'AVOID',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
            closingRemark: 'eliminated activity',
        });
        const risk = await globalPrisma.risk.findUniqueOrThrow({
            where: { id: RISK_ID },
        });
        expect(risk.status).toBe('CLOSED');
    });

    // ── 7. completePlan with zero milestones (ACCEPT fast path) ─────

    it('completePlan succeeds on a plan with zero milestones', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'ACCEPT',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        const r = await completePlan(
            ctxAs(Role.ADMIN, admin.userId),
            treatmentPlanId,
            { closingRemark: 'no milestones — pure acceptance' },
        );
        expect(r.newRiskStatus).toBe('ACCEPTED');
    });

    // ── 8. completePlan idempotency ────────────────────────────────

    it('completePlan rejects re-completion', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'ACCEPT',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
            closingRemark: 'first',
        });
        await expect(
            completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
                closingRemark: 'second',
            }),
        ).rejects.toThrow(/already complete/i);
    });

    // ── 9. getOverduePlans ─────────────────────────────────────────

    it('getOverduePlans returns only past-targetDate non-completed plans, ordered ascending', async () => {
        // Plan A — well overdue.
        const { treatmentPlanId: pA } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(1), // satisfies "future" guard
            },
        );
        // Plan B — recently overdue.
        const { treatmentPlanId: pB } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(2),
            },
        );
        // Plan C — still in future.
        const { treatmentPlanId: pC } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(60),
            },
        );
        // Plan D — completed (should NOT appear even if past).
        const { treatmentPlanId: pD } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'ACCEPT',
                ownerUserId: admin.userId,
                targetDate: futureDate(2),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), pD, {
            closingRemark: 'done',
        });

        // Force A + B targetDates into the past via raw update —
        // bypassing the usecase's future-only validation (which is
        // a creation-time guard, not a runtime guarantee).
        await globalPrisma.riskTreatmentPlan.update({
            where: { id: pA },
            data: { targetDate: pastDate(10) },
        });
        await globalPrisma.riskTreatmentPlan.update({
            where: { id: pB },
            data: { targetDate: pastDate(2) },
        });

        const overdue = await getOverduePlans(
            ctxAs(Role.ADMIN, admin.userId),
        );
        const ids = overdue.map((p) => p.id);
        expect(ids).toContain(pA);
        expect(ids).toContain(pB);
        expect(ids).not.toContain(pC);
        expect(ids).not.toContain(pD);
        // ASC order — pA (10 days overdue) before pB (2 days overdue).
        expect(ids.indexOf(pA)).toBeLessThan(ids.indexOf(pB));
    });

    // ── 10. Audit chain ────────────────────────────────────────────

    it('audit chain — create → milestone → complete → plan-complete → risk-status emits the canonical sequence', async () => {
        const { treatmentPlanId } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(60),
            },
        );
        const { milestoneId } = await addMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            treatmentPlanId,
            { title: 'm', dueDate: futureDate(30) },
        );
        await completeMilestone(
            ctxAs(Role.EDITOR, editor.userId),
            milestoneId,
            {},
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), treatmentPlanId, {
            closingRemark: 'done',
        });

        const audit = await globalPrisma.auditLog.findMany({
            where: {
                tenantId: TENANT_ID,
                action: {
                    in: [
                        'TREATMENT_PLAN_CREATED',
                        'TREATMENT_MILESTONE_ADDED',
                        'TREATMENT_MILESTONE_COMPLETED',
                        'TREATMENT_PLAN_COMPLETED',
                        'RISK_STATUS_CHANGED_BY_TREATMENT_PLAN',
                    ],
                },
            },
            orderBy: { createdAt: 'asc' },
            select: { action: true },
        });
        expect(audit.map((a) => a.action)).toEqual([
            'TREATMENT_PLAN_CREATED',
            'TREATMENT_MILESTONE_ADDED',
            'TREATMENT_MILESTONE_COMPLETED',
            'RISK_STATUS_CHANGED_BY_TREATMENT_PLAN',
            'TREATMENT_PLAN_COMPLETED',
        ]);
    });

    it('listTreatmentPlans returns plans for a tenant filtered by status', async () => {
        const { treatmentPlanId: a } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'ACCEPT',
                ownerUserId: admin.userId,
                targetDate: futureDate(30),
            },
        );
        const { treatmentPlanId: b } = await createTreatmentPlan(
            ctxAs(Role.ADMIN, admin.userId),
            {
                riskId: RISK_ID,
                strategy: 'MITIGATE',
                ownerUserId: admin.userId,
                targetDate: futureDate(60),
            },
        );
        await completePlan(ctxAs(Role.ADMIN, admin.userId), a, {
            closingRemark: 'done',
        });
        const all = await listTreatmentPlans(
            ctxAs(Role.ADMIN, admin.userId),
        );
        expect(new Set(all.map((p) => p.id))).toEqual(new Set([a, b]));
        const drafts = await listTreatmentPlans(
            ctxAs(Role.ADMIN, admin.userId),
            { status: 'DRAFT' },
        );
        expect(drafts.map((p) => p.id)).toEqual([b]);
    });
});
