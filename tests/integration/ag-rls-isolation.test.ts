/**
 * AG tenant-isolation fuzz tests — DB-backed (real Postgres RLS).
 *
 * Companion to `rls-isolation.test.ts`, focused on the AGRICULTURE surfaces.
 * Two tenants (A, B) each get a full ag graph; we then assert isolation
 * BEHAVIOURALLY (not just "a policy exists") across:
 *   - CRUD on Location / Parcel / OperationParcel / InventoryLot /
 *     StockTransaction / YieldRecord / Contract,
 *   - the spray-completion write path (markOperationParcel),
 *   - the inventory ledger-append write path (appendStockTransaction).
 *
 * Every cross-tenant attempt must FAIL CLOSED: a SELECT in tenant A's
 * context never returns tenant B's rows; an INSERT carrying tenant B's
 * tenantId from tenant A's context is rejected by RLS; a usecase invoked
 * with tenant A's context against tenant B's ids cannot read or mutate
 * B's data.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { withTenantDb, runInTenantContext } from '@/lib/db-context';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { appendStockTransaction } from '@/lib/inventory/stock-ledger';
import { markOperationParcel } from '@/app-layer/usecases/field-operation';
import { createParcel } from '@/app-layer/usecases/parcel';

const globalPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `agrls-${randomUUID().slice(0, 8)}`;

interface TenantGraph {
    tenantId: string;
    locationId: string;
    parcelId: string;
    itemId: string;
    lotId: string;
    taskId: string;
    lineId: string;
    contractId: string;
    yieldId: string;
}

let userId = '';
let unitId = '';
let A: TenantGraph;
let B: TenantGraph;

const ctxFor = (tenantId: string) =>
    makeRequestContext('OWNER', { userId, tenantId, tenantSlug: `${TAG}-${tenantId.slice(-6)}` });

/** Provision a full ag graph for one tenant using the raw (superuser) client. */
async function seedTenant(name: string): Promise<TenantGraph> {
    const tenant = await globalPrisma.tenant.create({
        data: { name: `${name} ${TAG}`, slug: `${TAG}-${name}`.toLowerCase() },
    });
    const tenantId = tenant.id;
    await globalPrisma.tenantMembership.create({
        data: { tenantId, userId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });

    const location = await globalPrisma.location.create({ data: { tenantId, name: `Loc ${name} ${TAG}` } });
    const parcel = await globalPrisma.parcel.create({
        data: { tenantId, locationId: location.id, name: `Parcel ${name} ${TAG}` },
    });
    const item = await globalPrisma.item.create({
        data: { tenantId, name: `Product ${name} ${TAG}`, category: 'PESTICIDE', defaultUnitId: unitId },
    });
    const lot = await globalPrisma.inventoryLot.create({
        data: { tenantId, itemId: item.id, lotCode: `LOT-${name}-${TAG}`, unitId },
    });
    // A FIELD_OPERATION task + one prescription line (the spray-completion target).
    const task = await globalPrisma.task.create({
        data: { tenantId, title: `Spray ${name} ${TAG}`, type: 'FIELD_OPERATION', createdByUserId: userId },
    });
    const line = await globalPrisma.operationParcel.create({
        data: {
            tenantId,
            taskId: task.id,
            parcelId: parcel.id,
            productItemId: item.id,
            doseValue: 2,
            doseUnitId: unitId,
            status: 'PENDING',
        },
    });
    const contract = await globalPrisma.contract.create({
        data: { tenantId, counterparty: `Buyer ${name} ${TAG}`, type: 'SALE', status: 'ACTIVE' },
    });
    const yieldRow = await globalPrisma.yieldRecord.create({
        data: { tenantId, commodity: `Wheat ${name} ${TAG}` },
    });

    const graph: TenantGraph = {
        tenantId,
        locationId: location.id,
        parcelId: parcel.id,
        itemId: item.id,
        lotId: lot.id,
        taskId: task.id,
        lineId: line.id,
        contractId: contract.id,
        yieldId: yieldRow.id,
    };

    // Seed one ledger row THROUGH the writer (RLS-bound) so the
    // StockTransaction hash chain + tenant context are real.
    await runInTenantContext(ctxFor(tenantId), (db) =>
        appendStockTransaction(db, ctxFor(tenantId), {
            lotId: graph.lotId,
            type: 'RECEIPT',
            quantityDelta: 50,
            unitId,
        }),
    );

    return graph;
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await globalPrisma.$connect();
    const email = `${TAG}@ag.test`;
    const user = await globalPrisma.user.create({
        data: { email, emailHash: hashForLookup(email), name: 'AG RLS User' },
    });
    userId = user.id;
    const unit = await globalPrisma.unit.create({
        data: { key: `l-per-ha-${TAG}`, name: 'Litres per hectare', symbol: 'L/ha', measure: 'RATE' },
    });
    unitId = unit.id;

    A = await seedTenant('A');
    B = await seedTenant('B');
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        for (const g of [A, B].filter(Boolean)) {
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "StockTransaction" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "OperationParcel" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "TaskLink" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "InventoryLot" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "Item" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "Parcel" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "Location" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "Contract" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "YieldRecord" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "tenantId" = $1`, g.tenantId).catch(() => {});
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1`, g.tenantId);
            await globalPrisma.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = $1`, g.tenantId);
        }
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "Unit" WHERE "id" = $1`, unitId);
        await globalPrisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = $1`, userId);
    } catch (e) {
        console.warn('[ag-rls-isolation] cleanup error:', e);
    }
    await globalPrisma.$disconnect();
});

describeFn('AG RLS tenant isolation (PostGIS)', () => {
    // ── SELECT isolation: tenant A's context never sees B's rows ──
    describe.each([
        ['location', (t: TenantGraph) => t.locationId] as const,
        ['parcel', (t: TenantGraph) => t.parcelId] as const,
        ['item', (t: TenantGraph) => t.itemId] as const,
        ['inventoryLot', (t: TenantGraph) => t.lotId] as const,
        ['operationParcel', (t: TenantGraph) => t.lineId] as const,
        ['contract', (t: TenantGraph) => t.contractId] as const,
        ['yieldRecord', (t: TenantGraph) => t.yieldId] as const,
    ])('%s SELECT isolation', (model, _idOf) => {
        it(`tenant A context returns only its own ${model} rows`, async () => {
            await withTenantDb(A.tenantId, async (tx) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rows: Array<{ tenantId: string }> = await (tx as any)[model].findMany();
                expect(rows.length).toBeGreaterThan(0);
                for (const r of rows) expect(r.tenantId).toBe(A.tenantId);
            }, globalPrisma);
        });

        it(`tenant B's ${model} row is invisible in tenant A context`, async () => {
            await withTenantDb(A.tenantId, async (tx) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const row = await (tx as any)[model].findUnique({ where: { id: _idOf(B) } });
                expect(row).toBeNull();
            }, globalPrisma);
        });
    });

    // ── INSERT isolation: cannot write a row carrying B's tenantId ──
    describe('INSERT isolation — foreign tenantId rejected by RLS', () => {
        it('cannot create a Location under tenant B from tenant A context', async () => {
            await expect(
                withTenantDb(A.tenantId, async (tx) => {
                    await tx.location.create({ data: { tenantId: B.tenantId, name: `Evil ${TAG}` } });
                }, globalPrisma),
            ).rejects.toThrow(/new row violates row-level security policy/);
        });

        it('cannot create a Contract under tenant B from tenant A context', async () => {
            await expect(
                withTenantDb(A.tenantId, async (tx) => {
                    await tx.contract.create({
                        data: { tenantId: B.tenantId, counterparty: `Evil ${TAG}`, type: 'SALE', status: 'DRAFT' },
                    });
                }, globalPrisma),
            ).rejects.toThrow(/new row violates row-level security policy/);
        });

        it('cannot create a YieldRecord under tenant B from tenant A context', async () => {
            await expect(
                withTenantDb(A.tenantId, async (tx) => {
                    await tx.yieldRecord.create({ data: { tenantId: B.tenantId, commodity: `Evil ${TAG}` } });
                }, globalPrisma),
            ).rejects.toThrow(/new row violates row-level security policy/);
        });

        it('cannot create an InventoryLot under tenant B from tenant A context', async () => {
            await expect(
                withTenantDb(A.tenantId, async (tx) => {
                    await tx.inventoryLot.create({
                        data: { tenantId: B.tenantId, itemId: B.itemId, lotCode: `EVIL-${TAG}`, unitId },
                    });
                }, globalPrisma),
            ).rejects.toThrow(/new row violates row-level security policy/);
        });
    });

    // ── DELETE isolation: tenant A cannot delete tenant B's rows ──
    describe('DELETE isolation — tenant B rows survive a cross-tenant delete', () => {
        it('deleteMany in tenant A context leaves tenant B contracts intact', async () => {
            await withTenantDb(A.tenantId, async (tx) => {
                await tx.contract.deleteMany({ where: { counterparty: { contains: TAG } } });
            }, globalPrisma);
            const bSurvives = await globalPrisma.contract.findUnique({ where: { id: B.contractId } });
            expect(bSurvives).not.toBeNull();
            expect(bSurvives!.tenantId).toBe(B.tenantId);
        });
    });

    // ── Write-path isolation: the real ag usecases fail closed ──
    describe('Ledger-append path — appendStockTransaction is tenant-scoped', () => {
        it('tenant A can append to its own lot', async () => {
            const res = await runInTenantContext(ctxFor(A.tenantId), (db) =>
                appendStockTransaction(db, ctxFor(A.tenantId), {
                    lotId: A.lotId,
                    type: 'ADJUSTMENT',
                    quantityDelta: -1,
                    unitId,
                    reason: 'count',
                }),
            );
            expect(res.id).toBeTruthy();
        });

        it('tenant A CANNOT append to tenant B’s lot (lot invisible under RLS)', async () => {
            await expect(
                runInTenantContext(ctxFor(A.tenantId), (db) =>
                    appendStockTransaction(db, ctxFor(A.tenantId), {
                        lotId: B.lotId,
                        type: 'ADJUSTMENT',
                        quantityDelta: -1,
                        unitId,
                        reason: 'cross-tenant',
                    }),
                ),
            ).rejects.toThrow();
            // B's ledger is untouched — its single seeded RECEIPT still stands.
            const bTx = await globalPrisma.stockTransaction.findMany({ where: { lotId: B.lotId } });
            expect(bTx.length).toBe(1);
        });
    });

    describe('Spray-completion path — markOperationParcel is tenant-scoped', () => {
        it('tenant A can complete its own prescription line', async () => {
            await expect(
                markOperationParcel(ctxFor(A.tenantId), A.taskId, A.lineId, 'DONE'),
            ).resolves.toBeDefined();
        });

        it('tenant A CANNOT complete tenant B’s line (task/line invisible)', async () => {
            await expect(
                markOperationParcel(ctxFor(A.tenantId), B.taskId, B.lineId, 'DONE'),
            ).rejects.toThrow();
            // B's line is still PENDING.
            const bLine = await globalPrisma.operationParcel.findUnique({ where: { id: B.lineId } });
            expect(bLine!.status).toBe('PENDING');
        });
    });

    describe('Parcel authoring path — createParcel is tenant-scoped', () => {
        it('tenant A CANNOT draw a parcel into tenant B’s location', async () => {
            const square = {
                type: 'Polygon' as const,
                coordinates: [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]],
            };
            await expect(
                createParcel(ctxFor(A.tenantId), B.locationId, { name: `Evil ${TAG}`, geometry: square }),
            ).rejects.toThrow(/not found/i);
            // No parcel leaked into B's location beyond the one we seeded.
            const bParcels = await globalPrisma.parcel.findMany({ where: { locationId: B.locationId } });
            expect(bParcels.length).toBe(1);
        });
    });

    // ── No-context: an app_user session with no tenant bound sees nothing ──
    describe('No tenant context set — ag tables return zero rows', () => {
        it.each(['Location', 'Parcel', 'InventoryLot', 'StockTransaction', 'Contract', 'YieldRecord', 'OperationParcel'])(
            '%s yields zero rows without app.tenant_id',
            async (table) => {
                const rows = await globalPrisma.$transaction(async (tx) => {
                    await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
                    return tx.$queryRawUnsafe<Array<{ id: string }>>(
                        `SELECT "id" FROM "${table}" WHERE "tenantId" IN ($1, $2)`,
                        A.tenantId,
                        B.tenantId,
                    );
                });
                expect(rows.length).toBe(0);
            },
        );
    });
});
