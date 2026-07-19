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
import { recordLeasePayment, listLeasePayments } from '@/app-layer/usecases/lease-payment';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `rr-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';
let leaseIdLeva = '';

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
    const p3 = await createParcel(ctx(), locationId, { name: 'RR-3', geometry: square(0.01) });
    // Priced lease ending soon (in the expiry window) + a second for the same lessor.
    const l1 = await createParcelLease(ctx(), p1.id, { lessorName: 'Агро ЕООД', lessorEik: '203045511', kind: 'ARENDA', rentAmount: 60, rentUnit: 'лв/дка', endDate: inDays(20) });
    await createParcelLease(ctx(), p2.id, { lessorName: 'Агро ЕООД', lessorEik: '203045511', kind: 'ARENDA', rentAmount: 60, rentUnit: 'лв/дка', endDate: inDays(400) });
    // MIXED UNIT — the SAME lessor also rents a parcel for grain, not money.
    // The roll must never blend this into the лв figure.
    await createParcelLease(ctx(), p3.id, { lessorName: 'Агро ЕООД', lessorEik: '203045511', kind: 'ARENDA', rentAmount: 80, rentUnit: 'кг/дка', endDate: inDays(400) });
    leaseIdLeva = l1.id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('rent roll aggregation', () => {
    test('aggregates leased area + rent by lessor', async () => {
        const rr = await getRentRoll(ctx(), { expiringWithinDays: 60 });
        // One LESSOR, but three leases across two units.
        expect(rr.lessorCount).toBe(1);
        expect(rr.activeLeaseCount).toBe(3);
        expect(rr.totalLeasedDca).toBeGreaterThan(0);
        // Rows are per (lessor × unit) — the money row holds only the лв leases.
        const leva = rr.byLessor.find((l) => l.rentUnit === 'лв/дка');
        const kg = rr.byLessor.find((l) => l.rentUnit === 'кг/дка');
        expect(leva).toBeDefined();
        expect(kg).toBeDefined();
        expect(leva!.leaseCount).toBe(2);
        expect(kg!.leaseCount).toBe(1);
        expect(leva!.rentTotal).toBeGreaterThan(0);
        expect(kg!.rentTotal).toBeGreaterThan(0);
    });

    test('never blends кг into лв — totals are per unit', async () => {
        const rr = await getRentRoll(ctx());
        const units = rr.totals.map((t) => t.unit).sort();
        expect(units).toEqual(['кг/дка', 'лв/дка']);
        const leva = rr.totals.find((t) => t.unit === 'лв/дка')!;
        const kg = rr.totals.find((t) => t.unit === 'кг/дка')!;
        // Each unit's total equals the sum of ITS OWN rows, nothing else.
        const sumFor = (u: string) =>
            rr.byLessor.filter((l) => l.rentUnit === u).reduce((s, l) => s + (l.rentTotal ?? 0), 0);
        expect(leva.total).toBeCloseTo(sumFor('лв/дка'), 6);
        expect(kg.total).toBeCloseTo(sumFor('кг/дка'), 6);
        expect(leva.total).not.toBeCloseTo(leva.total + kg.total, 6);
    });

    test('payments settle against the roll as paid/outstanding', async () => {
        const season = new Date().getUTCFullYear();
        const before = await getRentRoll(ctx(), { seasonYear: season });
        const levaBefore = before.totals.find((t) => t.unit === 'лв/дка')!;
        expect(levaBefore.paid).toBe(0);
        expect(levaBefore.outstanding).toBeCloseTo(levaBefore.total, 6);

        await recordLeasePayment(ctx(), leaseIdLeva, { seasonYear: season, amountPaid: 100 });
        expect(await listLeasePayments(ctx(), leaseIdLeva)).toHaveLength(1);

        const after = await getRentRoll(ctx(), { seasonYear: season });
        const levaAfter = after.totals.find((t) => t.unit === 'лв/дка')!;
        expect(levaAfter.paid).toBeCloseTo(100, 6);
        expect(levaAfter.outstanding).toBeCloseTo(levaAfter.total - 100, 6);
        // The grain books are untouched by a money payment.
        const kgAfter = after.totals.find((t) => t.unit === 'кг/дка')!;
        expect(kgAfter.paid).toBe(0);
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
        expect(rr.activeLeaseCount).toBe(3);
        const other = await getRentRoll(ctx(), { locationId: 'nonexistent-location' });
        expect(other.activeLeaseCount).toBe(0);
    });
});
