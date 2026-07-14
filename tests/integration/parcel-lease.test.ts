/**
 * Parcel lease register (roadmap 2/3) — DB-backed integration (RLS).
 *
 * Covers the аренда/наем CRUD usecase: create → list → update → soft-delete,
 * tenant-scoped. Also satisfies the usecase-test-coverage ratchet by importing
 * via the canonical `@/app-layer/usecases/parcel-lease`.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Polygon } from 'geojson';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createParcel } from '@/app-layer/usecases/parcel';
import {
    listParcelLeases,
    createParcelLease,
    updateParcelLease,
    deleteParcelLease,
} from '@/app-layer/usecases/parcel-lease';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `lease-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';
let parcelId = '';

const ctx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });
function square(size: number): Polygon {
    return { type: 'Polygon', coordinates: [[[0, 0], [0, size], [size, size], [size, 0], [0, 0]]] };
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: {}, create: { id: TENANT_ID, name: TENANT_ID, slug: TAG } });
    const u = await prisma.user.create({ data: { email: `${TAG}@example.test`, emailHash: hashForLookup(`${TAG}@example.test`) } });
    ownerId = u.id;
    await prisma.tenantMembership.create({ data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE } });
    const loc = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Block ${TAG}` } });
    locationId = loc.id;
    const p = await createParcel(ctx(), locationId, { name: 'Lease parcel', geometry: square(0.01) });
    parcelId = p.id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('parcel lease register (RLS)', () => {
    let leaseId = '';

    test('creates + lists a lease', async () => {
        const lease = await createParcelLease(ctx(), parcelId, {
            lessorName: 'Агро ЕООД',
            lessorEik: '203045511',
            kind: 'ARENDA',
            rentAmount: 60,
            rentUnit: 'лв/дка',
            startDate: '2026-01-01',
            endDate: '2031-01-01',
        });
        leaseId = lease.id;
        expect(lease.lessorName).toBe('Агро ЕООД');
        expect(lease.kind).toBe('ARENDA');

        const leases = await listParcelLeases(ctx(), parcelId);
        expect(leases).toHaveLength(1);
        expect(String(leases[0].rentAmount)).toBe('60');
        expect(leases[0].lessorEik).toBe('203045511');
    });

    test('updates a lease (аренда → наем, new rent)', async () => {
        const updated = await updateParcelLease(ctx(), leaseId, {
            lessorName: 'Агро ЕООД',
            kind: 'NAEM',
            rentAmount: 75,
            rentUnit: 'лв/дка',
        });
        expect(updated.kind).toBe('NAEM');
        expect(String(updated.rentAmount)).toBe('75');
    });

    test('soft-deletes a lease (drops from the list)', async () => {
        await deleteParcelLease(ctx(), leaseId);
        expect(await listParcelLeases(ctx(), parcelId)).toHaveLength(0);
    });

    test('rejects an empty lessor name', async () => {
        await expect(
            createParcelLease(ctx(), parcelId, { lessorName: '   ', kind: 'ARENDA' }),
        ).rejects.toThrow(/lessor/i);
    });
});
