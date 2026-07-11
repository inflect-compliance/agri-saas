/**
 * Optimistic lock for markOperationParcel (DB-backed).
 *
 * A field mark queued offline can replay hours later. Idempotency stops
 * DUPLICATION; the `version` optimistic lock stops STALENESS: a replay that
 * carries the version it saw is rejected with 409 STALE_DATA if a supervisor
 * changed the line meanwhile — it must NOT silently overwrite newer state.
 * A replay at the current version succeeds and bumps the version.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { markOperationParcel } from '@/app-layer/usecases/field-operation';

const globalPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `oplock-${randomUUID().slice(0, 8)}`;

let userId = '';
let unitId = '';
let tenantId = '';
let taskId = '';
let lineA = ''; // the line under test
let lineB = ''; // stays PENDING so the task never auto-resolves mid-test

const ctx = () => makeRequestContext('OWNER', { userId, tenantId, tenantSlug: `${TAG}-t` });

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await globalPrisma.$connect();
    const email = `${TAG}@ag.test`;
    userId = (await globalPrisma.user.create({ data: { email, emailHash: hashForLookup(email), name: 'OpLock User' } })).id;
    unitId = (await globalPrisma.unit.create({ data: { key: `l-ha-${TAG}`, name: 'L/ha', symbol: 'L/ha', measure: 'RATE' } })).id;

    const tenant = await globalPrisma.tenant.create({ data: { name: `T ${TAG}`, slug: `${TAG}-t` } });
    tenantId = tenant.id;
    await globalPrisma.tenantMembership.create({ data: { tenantId, userId, role: Role.OWNER, status: MembershipStatus.ACTIVE } });
    const location = await globalPrisma.location.create({ data: { tenantId, name: `Loc ${TAG}` } });
    const p1 = await globalPrisma.parcel.create({ data: { tenantId, locationId: location.id, name: `P1 ${TAG}` } });
    const p2 = await globalPrisma.parcel.create({ data: { tenantId, locationId: location.id, name: `P2 ${TAG}` } });
    const item = await globalPrisma.item.create({ data: { tenantId, name: `Prod ${TAG}`, category: 'PESTICIDE', defaultUnitId: unitId } });
    const task = await globalPrisma.task.create({
        data: { tenantId, title: `Spray ${TAG}`, type: 'FIELD_OPERATION', createdByUserId: userId, assigneeUserId: userId },
    });
    taskId = task.id;
    lineA = (await globalPrisma.operationParcel.create({
        data: { tenantId, taskId, parcelId: p1.id, productItemId: item.id, doseValue: 2, doseUnitId: unitId, status: 'PENDING' },
    })).id;
    lineB = (await globalPrisma.operationParcel.create({
        data: { tenantId, taskId, parcelId: p2.id, productItemId: item.id, doseValue: 2, doseUnitId: unitId, status: 'PENDING' },
    })).id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        for (const tbl of ['LogEntry', 'OperationParcel', 'TaskLink', 'Task', 'Item', 'Parcel', 'Location', 'AuditLog', 'AutomationExecution', 'TenantMembership']) {
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "${tbl}" WHERE "tenantId" = $1`, tenantId).catch(() => {});
        }
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = $1`, tenantId).catch(() => {});
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Unit" WHERE "id" = $1`, unitId).catch(() => {});
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = $1`, userId).catch(() => {});
    } catch { /* best-effort */ }
    await globalPrisma.$disconnect();
});

describeFn('markOperationParcel optimistic lock (DB-backed)', () => {
    it('a stale-version replay 409s and does NOT overwrite newer server state', async () => {
        // Supervisor marks line A SKIPPED (version 0 → 1).
        const first = await markOperationParcel(ctx(), taskId, lineA, 'SKIPPED', undefined, 0);
        expect(first.version).toBe(1);

        // A stale queued mark (captured version 0) replays wanting DONE.
        await expect(
            markOperationParcel(ctx(), taskId, lineA, 'DONE', undefined, 0),
        ).rejects.toMatchObject({ status: 409 });

        // The row was NOT overwritten — still SKIPPED at version 1.
        const row = await globalPrisma.operationParcel.findFirst({ where: { id: lineA }, select: { status: true, version: true } });
        expect(row).toMatchObject({ status: 'SKIPPED', version: 1 });
    });

    it('a current-version replay succeeds and bumps the version', async () => {
        // Same line, now correctly expecting version 1.
        const res = await markOperationParcel(ctx(), taskId, lineA, 'DONE', undefined, 1);
        expect(res.version).toBe(2);
        const row = await globalPrisma.operationParcel.findFirst({ where: { id: lineA }, select: { status: true, version: true } });
        expect(row).toMatchObject({ status: 'DONE', version: 2 });
    });

    it('an online mark with no expected version still works (unlocked path)', async () => {
        const res = await markOperationParcel(ctx(), taskId, lineB, 'DONE'); // no expectedVersion
        expect(res.version).toBe(1);
    });
});
