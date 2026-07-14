/**
 * Rent roll (roadmap 3/3) — DB-backed integration.
 *
 * Validates the tenant aggregation over the lease register: leased area, rent
 * per lessor (rentAmount × dca), and the expiry scan. Also satisfies the
 * usecase-test-coverage ratchet by importing `@/app-layer/usecases/rent-roll`.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Polygon } from 'geojson';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createParcel } from '@/app-layer/usecases/parcel';
import { createParcelLease } from '@/app-layer/usecases/parcel-lease';
import { getRentRoll } from '@/app-layer/usecases/rent-roll';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `rr-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';

const ctx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });
function square(size: number): Polygon {
    return { type: 'Polygon', coordinates: [[[0, 0], [0, size], [size, size], [size, 0], [0, 0]]] };
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: {}, create: { id: TENANT_ID, name: TENANT_ID, slug: TAG } });
    const u = await prisma.user.create({ data: { email: `${TAG}@example.test`, emailHash: hashForLookup(`${TAG}@example.test`) } });
    ownerId = u.id;
    await prisma.tenantMembership.create({ data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE } });
    const loc = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Block ${TAG}` } });
    locationId = loc.id;
    const p1 = await createParcel(ctx(), locationId, { name: 'RR-1', geometry: square(0.01) });
    const p2 = await createParcel(ctx(), locationId, { name: 'RR-2', geometry: square(0.01) });
    // Priced lease ending soon (in the expiry window) + a second for the same lessor.
    await createParcelLease(ctx(), p1.id, { lessorName: 'Агро ЕООД', lessorEik: '203045511', kind: 'ARENDA', rentAmount: 60, rentUnit: 'лв/дка', endDate: inDays(20) });
    await createParcelLease(ctx(), p2.id, { lessorName: 'Агро ЕООД', lessorEik: '203045511', kind: 'ARENDA', rentAmount: 60, rentUnit: 'лв/дка', endDate: inDays(400) });
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('rent roll aggregation', () => {
    test('aggregates leased area + rent by lessor', async () => {
        const rr = await getRentRoll(ctx(), { expiringWithinDays: 60 });
        expect(rr.lessorCount).toBe(1);
        expect(rr.activeLeaseCount).toBe(2);
        expect(rr.totalLeasedDca).toBeGreaterThan(0);
        const agro = rr.byLessor.find((l) => l.lessorName === 'Агро ЕООД');
        expect(agro).toBeDefined();
        expect(agro!.leaseCount).toBe(2);
        // rent = 60 лв/дка × leased dca > 0
        expect(agro!.rentTotal).toBeGreaterThan(0);
        expect(rr.totalRent).toBeGreaterThan(0);
    });

    test('lists contracts expiring within the window', async () => {
        const rr = await getRentRoll(ctx(), { expiringWithinDays: 60 });
        // only the lease ending in ~20 days is within 60; the 400-day one is not.
        expect(rr.expiringSoon).toHaveLength(1);
        expect(rr.expiringSoon[0].daysLeft).toBeGreaterThan(0);
        expect(rr.expiringSoon[0].daysLeft).toBeLessThanOrEqual(60);
    });

    test('scopes to a location when locationId is given', async () => {
        const rr = await getRentRoll(ctx(), { locationId });
        expect(rr.activeLeaseCount).toBe(2);
        const other = await getRentRoll(ctx(), { locationId: 'nonexistent-location' });
        expect(other.activeLeaseCount).toBe(0);
    });
});
