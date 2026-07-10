/**
 * Offline exactly-once — `createFieldOperation` idempotency (DB-backed).
 *
 * Companion to the mocked unit test. Exercises the REAL usecase against real
 * Postgres so both halves of the guarantee are proven against the live
 * schema:
 *   1. Two calls with the SAME `Idempotency-Key` (the outbox-item id a flaky
 *      link replays) yield the SAME Task — one row, one prescription set.
 *   2. The `(tenantId, clientMutationId)` unique index is the race backstop:
 *      a raw duplicate insert trips P2002, while multiple NULL-key rows
 *      (ordinary online creates) coexist freely (NULLS DISTINCT).
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createFieldOperation } from '@/app-layer/usecases/field-operation';

const globalPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `fopidem-${randomUUID().slice(0, 8)}`;

let userId = '';
let unitId = '';
let tenantId = '';
let locationId = '';
let parcelIds: string[] = [];
let itemId = '';

const ctx = () => makeRequestContext('OWNER', { userId, tenantId, tenantSlug: `${TAG}-t` });

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await globalPrisma.$connect();
    const email = `${TAG}@ag.test`;
    const user = await globalPrisma.user.create({
        data: { email, emailHash: hashForLookup(email), name: 'FOp Idem User' },
    });
    userId = user.id;
    const unit = await globalPrisma.unit.create({
        data: { key: `l-per-ha-${TAG}`, name: 'Litres per hectare', symbol: 'L/ha', measure: 'RATE' },
    });
    unitId = unit.id;

    const tenant = await globalPrisma.tenant.create({ data: { name: `T ${TAG}`, slug: `${TAG}-t` } });
    tenantId = tenant.id;
    await globalPrisma.tenantMembership.create({
        data: { tenantId, userId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });
    const location = await globalPrisma.location.create({ data: { tenantId, name: `Loc ${TAG}` } });
    locationId = location.id;
    const p1 = await globalPrisma.parcel.create({ data: { tenantId, locationId, name: `P1 ${TAG}` } });
    const p2 = await globalPrisma.parcel.create({ data: { tenantId, locationId, name: `P2 ${TAG}` } });
    parcelIds = [p1.id, p2.id];
    const item = await globalPrisma.item.create({
        data: { tenantId, name: `Product ${TAG}`, category: 'PESTICIDE', defaultUnitId: unitId },
    });
    itemId = item.id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "OperationParcel" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "TaskLink" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Item" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Parcel" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Location" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "tenantId" = $1`, tenantId).catch(() => {});
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = $1`, tenantId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Unit" WHERE "id" = $1`, unitId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = $1`, userId);
    } catch (e) {
        console.warn('[field-operation-idempotency] cleanup error:', e);
    }
    await globalPrisma.$disconnect();
});

const body = () => ({
    assigneeUserId: userId,
    parcelIds,
    productItemId: itemId,
    doseValue: 2,
    doseUnitId: unitId,
});

describeFn('createFieldOperation idempotency (DB-backed)', () => {
    it('a replayed Idempotency-Key returns the same Task — one row, no duplicate', async () => {
        const key = `outbox-${randomUUID()}`;

        const first = await createFieldOperation(ctx(), locationId, body(), key);
        const second = await createFieldOperation(ctx(), locationId, body(), key);

        // Same result body on replay.
        expect(second.taskId).toBe(first.taskId);
        expect(second.taskKey).toBe(first.taskKey);
        expect(second.parcelCount).toBe(first.parcelCount);

        // Exactly one Task carries the key …
        const tasks = await globalPrisma.task.findMany({ where: { tenantId, clientMutationId: key } });
        expect(tasks).toHaveLength(1);
        // … and exactly one prescription set (not doubled).
        const lines = await globalPrisma.operationParcel.count({ where: { tenantId, taskId: first.taskId } });
        expect(lines).toBe(parcelIds.length);
    });

    it('distinct keys create distinct Tasks', async () => {
        const a = await createFieldOperation(ctx(), locationId, body(), `outbox-${randomUUID()}`);
        const b = await createFieldOperation(ctx(), locationId, body(), `outbox-${randomUUID()}`);
        expect(a.taskId).not.toBe(b.taskId);
    });

    it('the (tenantId, clientMutationId) unique index rejects a raw duplicate', async () => {
        const key = `raw-${randomUUID()}`;
        await globalPrisma.task.create({
            data: { tenantId, title: `Dup ${TAG}`, type: 'FIELD_OPERATION', createdByUserId: userId, clientMutationId: key },
        });
        await expect(
            globalPrisma.task.create({
                data: { tenantId, title: `Dup2 ${TAG}`, type: 'FIELD_OPERATION', createdByUserId: userId, clientMutationId: key },
            }),
        ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('multiple NULL-key rows coexist (online creates are unconstrained)', async () => {
        // Two ordinary online creates (no Idempotency-Key) — both store NULL,
        // and NULLS DISTINCT means neither collides with the other.
        const t1 = await globalPrisma.task.create({
            data: { tenantId, title: `Null1 ${TAG}`, type: 'FIELD_OPERATION', createdByUserId: userId },
        });
        const t2 = await globalPrisma.task.create({
            data: { tenantId, title: `Null2 ${TAG}`, type: 'FIELD_OPERATION', createdByUserId: userId },
        });
        expect(t1.clientMutationId).toBeNull();
        expect(t2.clientMutationId).toBeNull();
        expect(t1.id).not.toBe(t2.id);
    });
});
