/**
 * In-map parcel authoring — DB-backed integration (real PostGIS).
 *
 * Coverage
 * --------
 *   1. createParcel persists the drawn polygon and derives areaHa from
 *      the geometry via ST_Area (geography) — never from the client.
 *   2. updateParcel reshapes the polygon and re-derives a larger areaHa;
 *      the owning Location's cached bounds widen to match.
 *   3. deleteParcel soft-deletes (row retained, deletedAt set) and the
 *      location bounds recompute (null when no parcels remain).
 */

import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Polygon } from 'geojson';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createParcel, updateParcel, deleteParcel } from '@/app-layer/usecases/parcel';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `par-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';

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
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('parcel authoring (PostGIS)', () => {
    let parcelId = '';

    test('createParcel persists geometry + derives areaHa from ST_Area', async () => {
        const created = await createParcel(ctx(), locationId, { name: 'Drawn 1', geometry: square(0.01) });
        parcelId = created.id;

        expect(created.areaHa).toBeGreaterThan(0);
        // ~0.01° × 0.01° near the equator ≈ 1.24 km² ≈ 124 ha.
        expect(created.areaHa!).toBeGreaterThan(100);
        expect(created.areaHa!).toBeLessThan(150);

        // The geometry actually landed (PostGIS reports a polygon).
        const rows = await prisma.$queryRawUnsafe<Array<{ gtype: string }>>(
            `SELECT GeometryType("geometry") AS gtype FROM "Parcel" WHERE "id" = $1`,
            parcelId,
        );
        expect(rows[0].gtype).toBe('MULTIPOLYGON'); // geometrySql coerces to Multi

        // Location bounds were stamped from the parcel extent.
        const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { boundsJson: true } });
        expect(Array.isArray(loc!.boundsJson)).toBe(true);
        expect((loc!.boundsJson as number[]).length).toBe(4);
    });

    test('updateParcel reshapes to a larger polygon — areaHa grows ~4×', async () => {
        const before = Number(
            (await prisma.parcel.findUnique({ where: { id: parcelId }, select: { areaHa: true } }))!.areaHa,
        );
        const res = await updateParcel(ctx(), parcelId, { geometry: square(0.02) }); // 2× side ⇒ ~4× area
        expect(res.areaHa).toBeGreaterThan(before * 3);
    });

    test('rejects a self-intersecting polygon (real ST_IsValid)', async () => {
        // A classic "bowtie" — the ring crosses itself.
        const bowtie: Polygon = {
            type: 'Polygon',
            coordinates: [[[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01], [0, 0]]],
        };
        await expect(createParcel(ctx(), locationId, { name: 'Bowtie', geometry: bowtie })).rejects.toThrow(/invalid/i);
    });

    test('deleteParcel soft-deletes and clears the location bounds', async () => {
        await deleteParcel(ctx(), parcelId);
        const row = await prisma.parcel.findUnique({ where: { id: parcelId }, select: { deletedAt: true } });
        expect(row!.deletedAt).not.toBeNull();

        // No parcels left → bounds recompute to null.
        const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { boundsJson: true } });
        expect(loc!.boundsJson).toBeNull();
    });
});
