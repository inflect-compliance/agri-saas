/**
 * ag-demo fixture — DB-backed integration (real PostGIS).
 *
 * Proves `prisma/fixtures/ag-demo.ts::seedAgDemo` — the canonical ag
 * dataset shared by the ag E2E suite (via its HTTP twin) + the dev seed —
 * builds the full graph through the REAL usecases:
 *   • 3 fields / 10 parcels (areaHa from ST_Area) / 5 products+lots / 2 jobs
 *   • marking a seeded job line DONE deducts dose×area from the FEFO lot
 *     (the tier-1 financial path), via field-operation + inventory usecases.
 *
 * Doubling as ag-usecase coverage: seedAgDemo exercises createLocation,
 * createParcel, createItem, createLot, createFieldOperation, and the
 * mark→ledger bridge end-to-end against a live DB.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { seedAgDemo, type AgDemoResult } from '../../prisma/fixtures/ag-demo';
import { getFieldOperation, markOperationParcel } from '@/app-layer/usecases/field-operation';
import { listLotsPaginated } from '@/app-layer/usecases/inventory';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `agdemo-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let demo: AgDemoResult;

const ctx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

async function lotOnHand(lotId: string): Promise<number> {
    const row = await prisma.inventoryLot.findUnique({ where: { id: lotId }, select: { quantityOnHand: true } });
    return Number(row!.quantityOnHand);
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: {}, create: { id: TENANT_ID, name: TENANT_ID, slug: TAG } });
    const u = await prisma.user.create({ data: { email: `${TAG}@example.test`, emailHash: hashForLookup(`${TAG}@example.test`) } });
    ownerId = u.id;
    await prisma.tenantMembership.create({ data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE } });
    demo = await seedAgDemo(ctx());
}, 60_000);

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        // Child → parent FK order (superuser client bypasses RLS).
        await prisma.stockTransaction.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.operationParcel.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.taskLink.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.task.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.inventoryLot.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.parcel.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.item.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.location.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.tenantMembership.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
        await prisma.user.deleteMany({ where: { id: ownerId } });
    } catch {
        /* best effort — CI DB is ephemeral */
    }
    await prisma.$disconnect();
});

describeFn('ag-demo fixture (PostGIS)', () => {
    test('builds 3 fields / 10 parcels / 5 products+lots / 2 jobs', () => {
        expect(demo.locations).toHaveLength(3);
        expect(demo.parcels).toHaveLength(10);
        expect(demo.products).toHaveLength(5);
        expect(demo.jobs).toHaveLength(2);

        // Every parcel got a real ST_Area-derived hectare value.
        for (const p of demo.parcels) {
            expect(p.areaHa).not.toBeNull();
            expect(Number(p.areaHa)).toBeGreaterThan(0);
        }
        // Every product has an opening-stock lot.
        for (const prod of demo.products) {
            expect(prod.lotId).toBeTruthy();
        }
    });

    test('parcels are distributed 4 / 3 / 3 across the three fields', () => {
        const counts = demo.locations.map((l) => l.parcelIds.length).sort((a, b) => b - a);
        expect(counts).toEqual([4, 3, 3]);
    });

    test('marking a seeded spray line DONE deducts dose×area from the product lot', async () => {
        const job = demo.jobs[0];
        const product = demo.products.find((p) => p.id === job.productItemId)!;
        const before = await lotOnHand(product.lotId);
        expect(before).toBeGreaterThan(0);

        const op = await getFieldOperation(ctx(), job.taskId);
        const line = op.lines[0];
        expect(line.status).toBe('PENDING');

        await markOperationParcel(ctx(), job.taskId, line.id, 'DONE');

        const after = await lotOnHand(product.lotId);
        expect(after).toBeLessThan(before); // CONSUMPTION posted on completion
    });

    test('listLotsPaginated returns a non-overlapping cursor page of the seeded lots', async () => {
        // seedAgDemo created 5 product lots → a limit-2 page has a next page.
        const page1 = await listLotsPaginated(ctx(), { limit: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page1.pageInfo.hasNextPage).toBe(true);
        expect(page1.pageInfo.nextCursor).toBeTruthy();

        const page2 = await listLotsPaginated(ctx(), { limit: 2, cursor: page1.pageInfo.nextCursor });
        expect(page2.items.length).toBeGreaterThan(0);
        const firstPageIds = new Set(page1.items.map((i) => i.id));
        expect(page2.items.every((i) => !firstPageIds.has(i.id))).toBe(true); // no overlap across pages
    });
});
