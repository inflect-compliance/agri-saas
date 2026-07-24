/**
 * Stock-ledger reconciliation + idempotency — DB-backed integration.
 *
 * The financial/regulatory core of the data-integrity epic:
 *   A. spray → log → ledger → yield reconciles to ZERO drift — after a
 *      realistic sequence (receipt, spray CONSUMPTION, harvest HARVEST_IN)
 *      every lot's `quantityOnHand` cache equals its ledger SUM and the
 *      hash chain verifies, so `runReconcileInventoryLedgers` reports no
 *      drift.
 *   B. idempotency (usecase) — applying the SAME OperationParcel twice
 *      deducts the lot exactly once (no double-deduct).
 *   C. idempotency (ledger backstop) — `appendStockTransaction` with a
 *      repeated dedup key is a no-op, race-safe under the advisory lock.
 *   D. drift detection — a corrupted cache is caught by the reconciler.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { runInTenantContext } from '@/lib/db-context';
import {
    appendStockTransaction,
    verifyStockChain,
    verifyLotBalances,
} from '@/lib/inventory/stock-ledger';
import {
    recordInputApplication,
    reconcileStockLedger,
    listLedgerReconciliationHistory,
} from '@/app-layer/usecases/inventory';
import { createFieldOperation, markOperationParcel } from '@/app-layer/usecases/field-operation';
import { createLogEntry } from '@/app-layer/usecases/journal';
import { runReconcileInventoryLedgers } from '@/app-layer/jobs/reconcile-inventory-ledgers';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `recon-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;

let ownerId = '';
let unitLId = '';
let unitRateId = '';
let itemId = '';
let harvestItemId = '';
let lotId = '';
let locationId = '';

const ownerCtx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

async function onHand(id: string): Promise<number> {
    const lot = await prisma.inventoryLot.findUnique({ where: { id }, select: { quantityOnHand: true } });
    return Number(lot!.quantityOnHand);
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: {}, create: { id: TENANT_ID, name: TENANT_ID, slug: TAG } });

    const email = `${TAG}-owner@example.test`;
    const u = await prisma.user.create({ data: { email, emailHash: hashForLookup(email) } });
    ownerId = u.id;
    await prisma.tenantMembership.create({
        data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });

    const unitL = await prisma.unit.create({ data: { key: `${TAG}-l`, name: 'Litre', symbol: 'L', measure: 'VOLUME' } });
    const unitRate = await prisma.unit.create({ data: { key: `${TAG}-l-ha`, name: 'L/ha', symbol: 'L/ha', measure: 'RATE' } });
    unitLId = unitL.id;
    unitRateId = unitRate.id;

    const item = await prisma.item.create({
        data: { tenantId: TENANT_ID, name: 'Recon Herbicide', category: 'PESTICIDE', defaultUnitId: unitLId },
    });
    itemId = item.id;
    const harvestItem = await prisma.item.create({
        data: { tenantId: TENANT_ID, name: 'Recon Wheat', category: 'HARVESTED_PRODUCE', defaultUnitId: unitLId },
    });
    harvestItemId = harvestItem.id;

    const lot = await prisma.inventoryLot.create({
        data: { tenantId: TENANT_ID, itemId, lotCode: `LOT-${TAG}`, unitId: unitLId, quantityOnHand: 0 },
    });
    lotId = lot.id;

    const location = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Block ${TAG}` } });
    locationId = location.id;

    // Seed the lot with a 100 L RECEIPT so the spray has stock to draw on.
    await runInTenantContext(ownerCtx(), (db) =>
        appendStockTransaction(db, ownerCtx(), { lotId, type: 'RECEIPT', quantityDelta: 100, unitId: unitLId }),
    );
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
            await tx.$executeRawUnsafe(`DELETE FROM "StockTransaction" WHERE "tenantId" = $1`, TENANT_ID);
        });
    } catch {
        /* globalSetup handles reset */
    }
    await prisma.$disconnect();
});

describeFn('stock-ledger reconciliation + idempotency (DB)', () => {
    test('A — spray → log → ledger → yield reconciles to zero drift', async () => {
        const ctx = ownerCtx();

        // spray: 2 L/ha × 10 ha = 20 L CONSUMPTION + INPUT_APPLICATION log
        const parcel = await prisma.parcel.create({
            data: { tenantId: TENANT_ID, locationId, name: 'PA', areaHa: 10 },
        });
        const job = await createFieldOperation(ctx, locationId, {
            assigneeUserId: ownerId,
            parcelIds: [parcel.id],
            productItemId: itemId,
            doseValue: 2,
            doseUnitId: unitRateId,
        });
        const line = await prisma.operationParcel.findFirst({ where: { taskId: job.taskId }, select: { id: true } });
        const res = await markOperationParcel(ctx, job.taskId, line!.id, 'DONE');
        expect(res.application?.consumed).toBe(20);
        expect(await onHand(lotId)).toBe(80); // 100 receipt − 20 consumption

        // yield: a HARVEST journal entry mints an output lot (HARVEST_IN).
        await createLogEntry(ctx, {
            type: 'HARVEST',
            title: 'Harvest PA',
            harvest: { itemId: harvestItemId, quantity: 12, parcelId: parcel.id },
        } as Parameters<typeof createLogEntry>[1]);

        // RECONCILE: every lot's cache == ledger SUM, and the chain verifies.
        const balances = await runInTenantContext(ctx, (db) => verifyLotBalances(db, TENANT_ID));
        expect(balances.balanced).toBe(true);
        expect(balances.drift).toEqual([]);
        expect(balances.lotsChecked).toBeGreaterThanOrEqual(2); // herbicide lot + harvest lot

        const chain = await runInTenantContext(ctx, (db) => verifyStockChain(db, TENANT_ID));
        expect(chain.valid).toBe(true);

        const recon = await runReconcileInventoryLedgers({ tenantId: TENANT_ID });
        expect(recon.tenantsChecked).toBe(1);
        expect(recon.tenantsWithDrift).toBe(0);
        expect(recon.reconciliations[0].balanced).toBe(true);
        expect(recon.reconciliations[0].chainValid).toBe(true);
    });

    test('B — applying the same OperationParcel twice does not double-deduct', async () => {
        const ctx = ownerCtx();
        const parcel = await prisma.parcel.create({
            data: { tenantId: TENANT_ID, locationId, name: 'PB', areaHa: 5 },
        });
        const job = await createFieldOperation(ctx, locationId, {
            assigneeUserId: ownerId,
            parcelIds: [parcel.id],
            productItemId: itemId,
            doseValue: 2, // 2 L/ha × 5 ha = 10 L
            doseUnitId: unitRateId,
        });
        const line = await prisma.operationParcel.findFirst({ where: { taskId: job.taskId }, select: { id: true } });

        const before = await onHand(lotId);
        // First application (direct usecase call inside a tenant tx).
        const first = await runInTenantContext(ctx, (db) =>
            recordInputApplication(db, ctx, {
                id: line!.id,
                parcelId: parcel.id,
                productItemId: itemId,
                doseValue: 2,
                doseUnitId: unitRateId,
            }),
        );
        expect(first.consumed).toBe(10);
        expect(await onHand(lotId)).toBe(before - 10);

        // Retry with the SAME operationParcel id → idempotent no-op.
        const retry = await runInTenantContext(ctx, (db) =>
            recordInputApplication(db, ctx, {
                id: line!.id,
                parcelId: parcel.id,
                productItemId: itemId,
                doseValue: 2,
                doseUnitId: unitRateId,
            }),
        );
        expect(retry.note).toBe('already_applied');
        expect(await onHand(lotId)).toBe(before - 10); // NOT deducted twice

        // Exactly one CONSUMPTION carries the stable dedup key for this line.
        const dupes = await prisma.stockTransaction.count({
            where: { tenantId: TENANT_ID, idempotencyKey: `spray:${line!.id}` },
        });
        expect(dupes).toBe(1);
    });

    test('C — appendStockTransaction dedups a repeated idempotency key (ledger backstop)', async () => {
        const ctx = ownerCtx();
        const before = await onHand(lotId);
        const key = `manual:${randomUUID()}`;

        const a = await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId, type: 'ADJUSTMENT', quantityDelta: -3, unitId: unitLId, reason: 'shrinkage', idempotencyKey: key }),
        );
        expect(a.deduplicated).toBeFalsy();
        expect(await onHand(lotId)).toBe(before - 3);

        // Same key again → no second movement, on-hand unchanged.
        const b = await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId, type: 'ADJUSTMENT', quantityDelta: -3, unitId: unitLId, reason: 'shrinkage', idempotencyKey: key }),
        );
        expect(b.deduplicated).toBe(true);
        expect(b.id).toBe(a.id);
        expect(await onHand(lotId)).toBe(before - 3);
    });

    test('D — the reconciler catches a corrupted quantityOnHand cache', async () => {
        const ctx = ownerCtx();
        // Corrupt the denormalised cache out-of-band (the immutability
        // trigger guards StockTransaction, NOT the lot cache).
        await prisma.inventoryLot.update({ where: { id: lotId }, data: { quantityOnHand: 999999 } });

        const balances = await runInTenantContext(ctx, (db) => verifyLotBalances(db, TENANT_ID));
        expect(balances.balanced).toBe(false);
        expect(balances.drift.some((d) => d.lotId === lotId)).toBe(true);

        const recon = await runReconcileInventoryLedgers({ tenantId: TENANT_ID });
        expect(recon.tenantsWithDrift).toBe(1);

        // Restore the cache from the ledger so later assertions/cleanup are sane.
        const agg = await prisma.stockTransaction.aggregate({
            where: { tenantId: TENANT_ID, lotId },
            _sum: { quantityDelta: true },
        });
        await prisma.inventoryLot.update({
            where: { id: lotId },
            data: { quantityOnHand: agg._sum.quantityDelta ?? 0 },
        });
    });

    // ── Flag 4: the on-demand admin reconcile surfaces BOTH halves ──
    test('E — reconcileStockLedger reports chain AND balance health (negative surfaced)', async () => {
        const ctx = ownerCtx();
        // A fresh lot over-consumed into the negative (the spray path records
        // the true consumption; conservation is enforced by DETECTION here).
        const negLot = await prisma.inventoryLot.create({
            data: { tenantId: TENANT_ID, itemId, lotCode: `RECNEG-${TAG}`, unitId: unitLId, quantityOnHand: 0 },
        });
        await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId: negLot.id, type: 'RECEIPT', quantityDelta: 2, unitId: unitLId }),
        );
        await runInTenantContext(ctx, (db) =>
            appendStockTransaction(db, ctx, { lotId: negLot.id, type: 'CONSUMPTION', quantityDelta: -6, unitId: unitLId }),
        );

        const report = await reconcileStockLedger(ctx);
        // Chain intact, but the balance half is NOT healthy — "verified
        // intact" can no longer hide the negative on-hand.
        expect(report.valid).toBe(true);
        expect(report.balances.healthy).toBe(false);
        expect(report.balances.negative.some((n) => n.lotId === negLot.id)).toBe(true);

        // The run is recorded in history carrying the balance status.
        const history = await listLedgerReconciliationHistory(ctx);
        expect(history[0].valid).toBe(true);
        expect(history[0].balanceHealthy).toBe(false);
        expect(history[0].negativeCount ?? 0).toBeGreaterThanOrEqual(1);
        expect(history[0].lotsChecked ?? 0).toBeGreaterThanOrEqual(1);
    });
});
