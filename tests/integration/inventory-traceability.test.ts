/**
 * Inventory traceability — DB-backed integration tests.
 *
 * Coverage
 * --------
 *   1. A HARVEST journal entry mints a HARVEST_IN inventory lot, posts the
 *      hash-chained HARVEST_IN ledger entry, and records DERIVATION lot
 *      genealogy from every input lot consumed on the harvested field.
 *   2. traceLot walks the genealogy both ways: from a seed/input lot down
 *      to the harvest lot it produced, and from a harvest lot up to its
 *      input lots — annotating each with the fields it touched
 *      (seed-lot → field → harvest-lot).
 *   3. LotLink is append-only — UPDATE/DELETE raise the
 *      IMMUTABLE_LOT_GENEALOGY trigger.
 *   4. appendLotLink rejects self-edges and is idempotent on a duplicate.
 */

import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { runInTenantContext } from '@/lib/db-context';
import { appendStockTransaction, appendLotLink } from '@/lib/inventory/stock-ledger';
import { traceLot } from '@/app-layer/usecases/inventory';
import { createLogEntry } from '@/app-layer/usecases/journal';
import { createFieldOperation, markOperationParcel } from '@/app-layer/usecases/field-operation';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `trace-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;

let ownerId = '';
let unitLId = '';
let unitRateId = '';
let unitKgId = '';
let inputItemId = '';
let produceItemId = '';
let inputLotId = '';
let locationId = '';
let parcelId = '';

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: { id: TENANT_ID, name: TENANT_ID, slug: TAG },
    });
    const email = `${TAG}-owner@example.test`;
    const u = await prisma.user.create({ data: { email, emailHash: hashForLookup(email) } });
    ownerId = u.id;
    await prisma.tenantMembership.create({
        data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });

    const unitL = await prisma.unit.create({ data: { key: `${TAG}-l`, name: 'Litre', symbol: 'L', measure: 'VOLUME' } });
    const unitRate = await prisma.unit.create({ data: { key: `${TAG}-l-ha`, name: 'L/ha', symbol: 'L/ha', measure: 'RATE' } });
    const unitKg = await prisma.unit.create({ data: { key: `${TAG}-kg`, name: 'Kilogram', symbol: 'kg', measure: 'WEIGHT' } });
    unitLId = unitL.id;
    unitRateId = unitRate.id;
    unitKgId = unitKg.id;

    const inputItem = await prisma.item.create({
        data: { tenantId: TENANT_ID, name: 'Trace Fertiliser', category: 'FERTILIZER', defaultUnitId: unitLId },
    });
    inputItemId = inputItem.id;
    const produceItem = await prisma.item.create({
        data: { tenantId: TENANT_ID, name: 'Trace Wheat', category: 'HARVESTED_PRODUCE', defaultUnitId: unitKgId },
    });
    produceItemId = produceItem.id;

    const lot = await prisma.inventoryLot.create({
        data: { tenantId: TENANT_ID, itemId: inputItemId, lotCode: `INPUT-${TAG}`, unitId: unitLId, quantityOnHand: 0 },
    });
    inputLotId = lot.id;

    const location = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Field ${TAG}` } });
    locationId = location.id;
    const parcel = await prisma.parcel.create({
        data: { tenantId: TENANT_ID, locationId, name: `P-${TAG}`, areaHa: 4 },
    });
    parcelId = parcel.id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
            await tx.$executeRawUnsafe(`DELETE FROM "LotLink" WHERE "tenantId" = $1`, TENANT_ID);
            await tx.$executeRawUnsafe(`DELETE FROM "StockTransaction" WHERE "tenantId" = $1`, TENANT_ID);
        });
    } catch {
        /* globalSetup handles reset */
    }
    await prisma.$disconnect();
});

const ownerCtx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

describeFn('inventory traceability (DB)', () => {
    let harvestLotId = '';

    test('seed-lot → field → harvest-lot: harvest mints a lot + DERIVATION genealogy', async () => {
        const ctx = ownerCtx();

        // 1 — receive input stock, then consume it on the field via a spray op.
        await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId: inputLotId, type: 'RECEIPT', quantityDelta: 100, unitId: unitLId }),
        );
        const job = await createFieldOperation(ctx, locationId, {
            assigneeUserId: ownerId,
            parcelIds: [parcelId],
            productItemId: inputItemId,
            doseValue: 5, // 5 L/ha × 4 ha = 20 L consumed on the parcel
            doseUnitId: unitRateId,
        });
        const line = await prisma.operationParcel.findFirst({ where: { taskId: job.taskId }, select: { id: true } });
        await markOperationParcel(ctx, job.taskId, line!.id, 'DONE');

        // 2 — record the HARVEST entry with an output-lot payload from the same field.
        const entry = await createLogEntry(ctx, {
            type: 'HARVEST',
            title: `Harvest ${TAG}`,
            harvest: { itemId: produceItemId, quantity: 500, parcelId, lotCode: `HARV-${TAG}` },
        });

        // 3 — the harvest lot + its HARVEST_IN ledger entry exist.
        const harvestLot = await prisma.inventoryLot.findFirst({
            where: { tenantId: TENANT_ID, itemId: produceItemId, lotCode: `HARV-${TAG}` },
            select: { id: true, quantityOnHand: true },
        });
        expect(harvestLot).not.toBeNull();
        expect(Number(harvestLot!.quantityOnHand)).toBe(500);
        harvestLotId = harvestLot!.id;

        const harvestIn = await prisma.stockTransaction.findFirst({
            where: { tenantId: TENANT_ID, lotId: harvestLotId, type: 'HARVEST_IN' },
            select: { logEntryId: true, quantityDelta: true },
        });
        expect(harvestIn).not.toBeNull();
        expect(harvestIn!.logEntryId).toBe(entry.id);
        expect(Number(harvestIn!.quantityDelta)).toBe(500);

        // 4 — a DERIVATION edge links the consumed input lot → the harvest lot.
        const link = await prisma.lotLink.findFirst({
            where: { tenantId: TENANT_ID, parentLotId: inputLotId, childLotId: harvestLotId },
            select: { type: true, logEntryId: true },
        });
        expect(link).not.toBeNull();
        expect(link!.type).toBe('DERIVATION');
        expect(link!.logEntryId).toBe(entry.id);
    });

    test('traceLot walks descendants (input lot → harvest lot) with the field annotated', async () => {
        const ctx = ownerCtx();
        const trace = await traceLot(ctx, inputLotId);

        expect(trace.root.id).toBe(inputLotId);
        // The harvest lot is downstream of the input lot.
        expect(trace.descendants.map((d) => d.id)).toContain(harvestLotId);
        // The input lot's field (consumed-on parcel) is recorded.
        expect(trace.root.fields.map((f) => f.id)).toContain(parcelId);
        // An edge input → harvest is present.
        expect(trace.edges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ parentLotId: inputLotId, childLotId: harvestLotId }),
            ]),
        );
    });

    test('traceLot walks ancestors (harvest lot → input lot) with the harvest field annotated', async () => {
        const ctx = ownerCtx();
        const trace = await traceLot(ctx, harvestLotId);

        expect(trace.root.id).toBe(harvestLotId);
        expect(trace.ancestors.map((a) => a.id)).toContain(inputLotId);
        // The harvest lot records its source field (attributesJson.harvestedFromParcelId).
        expect(trace.root.fields.map((f) => f.id)).toContain(parcelId);
    });

    test('LotLink is append-only — UPDATE and DELETE are blocked', async () => {
        const row = await prisma.lotLink.findFirst({ where: { tenantId: TENANT_ID }, select: { id: true } });
        await expect(
            prisma.$executeRawUnsafe(`UPDATE "LotLink" SET "note" = 'tamper' WHERE "id" = $1`, row!.id),
        ).rejects.toThrow(/IMMUTABLE_LOT_GENEALOGY/);
        await expect(
            prisma.$executeRawUnsafe(`DELETE FROM "LotLink" WHERE "id" = $1`, row!.id),
        ).rejects.toThrow(/IMMUTABLE_LOT_GENEALOGY/);
    });

    test('appendLotLink rejects a self-edge and is idempotent on a duplicate', async () => {
        const ctx = ownerCtx();
        const self = await runInTenantContext(ctx, (db) =>
            appendLotLink(db, ctx, { parentLotId: harvestLotId, childLotId: harvestLotId }),
        );
        expect(self.created).toBe(false);

        // The input→harvest edge already exists from the harvest wiring.
        const dup = await runInTenantContext(ctx, (db) =>
            appendLotLink(db, ctx, { parentLotId: inputLotId, childLotId: harvestLotId }),
        );
        expect(dup.created).toBe(false);
    });
});
