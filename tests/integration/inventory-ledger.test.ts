/**
 * Inventory ledger — DB-backed integration tests.
 *
 * Coverage
 * --------
 *   1. appendStockTransaction extends the per-tenant hash chain
 *      (previousHash linkage) and refreshes InventoryLot.quantityOnHand
 *      from the ledger sum, atomically.
 *   2. StockTransaction is append-only — UPDATE/DELETE raise the
 *      IMMUTABLE_STOCK_LEDGER trigger (incl. the privileged client).
 *   3. verifyStockChain reports a valid chain and detects a tampered row.
 *   4. Spray completion end-to-end: marking an OperationParcel DONE emits
 *      an INPUT_APPLICATION LogEntry + a CONSUMPTION ledger entry against
 *      the product's FEFO lot, and the lot's on-hand decreases.
 */

import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { runInTenantContext } from '@/lib/db-context';
import { appendStockTransaction, verifyStockChain } from '@/lib/inventory/stock-ledger';
import { createFieldOperation, markOperationParcel } from '@/app-layer/usecases/field-operation';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `inv-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
const TENANT2_ID = `t-${TAG}-2`;

let ownerId = '';
let unitLId = '';
let unitRateId = '';
let itemId = '';
let lotId = '';

async function makeUser(label: string): Promise<string> {
    const email = `${TAG}-${label}@example.test`;
    const u = await prisma.user.create({ data: { email, emailHash: hashForLookup(email) } });
    return u.id;
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    for (const [id, slug] of [[TENANT_ID, TAG], [TENANT2_ID, `${TAG}-2`]] as const) {
        await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug } });
    }
    ownerId = await makeUser('owner');
    await prisma.tenantMembership.create({
        data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });

    const unitL = await prisma.unit.create({ data: { key: `${TAG}-l`, name: 'Litre', symbol: 'L', measure: 'VOLUME' } });
    const unitRate = await prisma.unit.create({ data: { key: `${TAG}-l-ha`, name: 'L/ha', symbol: 'L/ha', measure: 'RATE' } });
    unitLId = unitL.id;
    unitRateId = unitRate.id;

    const item = await prisma.item.create({
        data: { tenantId: TENANT_ID, name: 'ITest Herbicide', category: 'PESTICIDE', defaultUnitId: unitLId },
    });
    itemId = item.id;

    const lot = await prisma.inventoryLot.create({
        data: { tenantId: TENANT_ID, itemId, lotCode: `LOT-${TAG}`, unitId: unitLId, quantityOnHand: 0 },
    });
    lotId = lot.id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
            for (const t of [TENANT_ID, TENANT2_ID]) {
                await tx.$executeRawUnsafe(`DELETE FROM "StockTransaction" WHERE "tenantId" = $1`, t);
            }
        });
    } catch {
        /* globalSetup handles reset */
    }
    await prisma.$disconnect();
});

const ownerCtx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

describeFn('inventory ledger (DB)', () => {
    test('appendStockTransaction chains hashes + refreshes the lot on-hand cache', async () => {
        const ctx = ownerCtx();
        const r1 = await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId, type: 'RECEIPT', quantityDelta: 100, unitId: unitLId }),
        );
        const r2 = await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId, type: 'CONSUMPTION', quantityDelta: -20, unitId: unitLId }),
        );

        expect(r1.previousHash).toBeNull();
        expect(r2.previousHash).toBe(r1.entryHash);

        const lot = await prisma.inventoryLot.findUnique({ where: { id: lotId }, select: { quantityOnHand: true } });
        expect(Number(lot!.quantityOnHand)).toBe(80); // 100 − 20

        const verify = await runInTenantContext(ctx, (db) => verifyStockChain(db, TENANT_ID));
        expect(verify.valid).toBe(true);
        expect(verify.totalEntries).toBe(2);
    });

    test('StockTransaction is append-only — UPDATE and DELETE are blocked', async () => {
        const row = await prisma.stockTransaction.findFirst({ where: { tenantId: TENANT_ID }, select: { id: true } });
        await expect(
            prisma.$executeRawUnsafe(`UPDATE "StockTransaction" SET "reason" = 'tamper' WHERE "id" = $1`, row!.id),
        ).rejects.toThrow(/IMMUTABLE_STOCK_LEDGER/);
        await expect(
            prisma.$executeRawUnsafe(`DELETE FROM "StockTransaction" WHERE "id" = $1`, row!.id),
        ).rejects.toThrow(/IMMUTABLE_STOCK_LEDGER/);
    });

    test('verifyStockChain detects a tampered row (tenant-isolated)', async () => {
        const ctx = makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT2_ID, tenantSlug: `${TAG}-2` });
        // membership in T2 so RLS lets the owner write its chain
        await prisma.tenantMembership.create({
            data: { tenantId: TENANT2_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
        });
        const item2 = await prisma.item.create({
            data: { tenantId: TENANT2_ID, name: 'T2 product', category: 'FERTILIZER', defaultUnitId: unitLId },
        });
        const lot2 = await prisma.inventoryLot.create({
            data: { tenantId: TENANT2_ID, itemId: item2.id, lotCode: `LOT2-${TAG}`, unitId: unitLId, quantityOnHand: 0 },
        });
        await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId: lot2.id, type: 'RECEIPT', quantityDelta: 50, unitId: unitLId }),
        );

        const before = await runInTenantContext(ctx, (db) => verifyStockChain(db, TENANT2_ID));
        expect(before.valid).toBe(true);

        // Tamper bypassing the immutability trigger (replica role).
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
            await tx.$executeRawUnsafe(`UPDATE "StockTransaction" SET "quantityDelta" = 9999 WHERE "tenantId" = $1`, TENANT2_ID);
        });

        const after = await runInTenantContext(ctx, (db) => verifyStockChain(db, TENANT2_ID));
        expect(after.valid).toBe(false);
    });

    test('marking an OperationParcel DONE emits a CONSUMPTION + INPUT_APPLICATION and decrements the lot', async () => {
        const ctx = ownerCtx();

        const location = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Block ${TAG}` } });
        const parcel = await prisma.parcel.create({
            data: { tenantId: TENANT_ID, locationId: location.id, name: 'P1', areaHa: 10 },
        });

        const job = await createFieldOperation(ctx, location.id, {
            assigneeUserId: ownerId,
            parcelIds: [parcel.id],
            productItemId: itemId,
            doseValue: 2, // 2 L/ha × 10 ha = 20 L consumed
            doseUnitId: unitRateId,
        });

        const line = await prisma.operationParcel.findFirst({ where: { taskId: job.taskId }, select: { id: true } });
        const onHandBefore = Number(
            (await prisma.inventoryLot.findUnique({ where: { id: lotId }, select: { quantityOnHand: true } }))!.quantityOnHand,
        );

        const res = await markOperationParcel(ctx, job.taskId, line!.id, 'DONE');
        expect(res.application?.consumed).toBe(20);
        expect(res.application?.deductedFromLotId).toBe(lotId);

        // A CONSUMPTION ledger row linked to a LogEntry exists.
        const consumption = await prisma.stockTransaction.findFirst({
            where: { tenantId: TENANT_ID, lotId, type: 'CONSUMPTION', quantityDelta: -20 },
            select: { logEntryId: true },
        });
        expect(consumption).not.toBeNull();
        expect(consumption!.logEntryId).toBeTruthy();

        // The INPUT_APPLICATION journal record points back at the line.
        const logEntry = await prisma.logEntry.findFirst({
            where: { tenantId: TENANT_ID, type: 'INPUT_APPLICATION', operationParcelId: line!.id },
            include: { quantities: true },
        });
        expect(logEntry).not.toBeNull();
        expect(logEntry!.quantities.length).toBe(1);
        expect(Number(logEntry!.quantities[0].value)).toBe(20);

        const onHandAfter = Number(
            (await prisma.inventoryLot.findUnique({ where: { id: lotId }, select: { quantityOnHand: true } }))!.quantityOnHand,
        );
        expect(onHandAfter).toBe(onHandBefore - 20);
    });
});
