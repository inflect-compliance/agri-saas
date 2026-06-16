/**
 * In-map parcel merge / split — DB-backed integration (real PostGIS).
 *
 * Coverage
 * --------
 *   1. mergeParcels unions ≥2 adjacent parcels into one new parcel whose
 *      areaHa ≈ the sum; the originals are soft-deleted.
 *   2. splitParcel cuts one parcel along a drawn line into two pieces, each
 *      ≈ half the area; the original is soft-deleted.
 *   3. A blade that does not fully cross the parcel is rejected.
 *   4. Merge is tenant/location-scoped — a foreign parcel id is rejected,
 *      never unioned across the boundary.
 */

import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Polygon, LineString } from 'geojson';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createParcel, mergeParcels, splitParcel } from '@/app-layer/usecases/parcel';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `pms-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';

const ctx = () =>
    makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

/** Axis-aligned rectangle [x0,y0]→[x1,y1] as a closed GeoJSON Polygon. */
function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
    return {
        type: 'Polygon',
        coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]],
    };
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: { id: TENANT_ID, name: TENANT_ID, slug: TAG },
    });
    const u = await prisma.user.create({
        data: { email: `${TAG}@example.test`, emailHash: hashForLookup(`${TAG}@example.test`) },
    });
    ownerId = u.id;
    await prisma.tenantMembership.create({
        data: { tenantId: TENANT_ID, userId: ownerId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    });
    const loc = await prisma.location.create({ data: { tenantId: TENANT_ID, name: `Block ${TAG}` } });
    locationId = loc.id;
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$disconnect();
});

describeFn('parcel merge / split (PostGIS)', () => {
    test('mergeParcels unions two adjacent parcels; originals soft-deleted', async () => {
        // Two squares sharing the edge x=0.01 → union is one 0.02×0.01 rect.
        const a = await createParcel(ctx(), locationId, { name: 'West', geometry: rect(0, 0, 0.01, 0.01) });
        const b = await createParcel(ctx(), locationId, { name: 'East', geometry: rect(0.01, 0, 0.02, 0.01) });
        const sum = (a.areaHa ?? 0) + (b.areaHa ?? 0);

        const merged = await mergeParcels(ctx(), locationId, [a.id, b.id], 'Whole Block');
        // Union area ≈ the sum of the two (shared edge has zero area).
        expect(merged.areaHa!).toBeGreaterThan(sum * 0.98);
        expect(merged.areaHa!).toBeLessThan(sum * 1.02);

        // Originals soft-deleted; the merged parcel is live + a MultiPolygon.
        for (const id of [a.id, b.id]) {
            const row = await prisma.parcel.findUnique({ where: { id }, select: { deletedAt: true } });
            expect(row!.deletedAt).not.toBeNull();
        }
        const live = await prisma.parcel.findUnique({ where: { id: merged.id }, select: { deletedAt: true, name: true } });
        expect(live!.deletedAt).toBeNull();
        expect(live!.name).toBe('Whole Block');
        const gt = await prisma.$queryRawUnsafe<Array<{ gtype: string }>>(
            `SELECT GeometryType("geometry") AS gtype FROM "Parcel" WHERE "id" = $1`,
            merged.id,
        );
        expect(gt[0].gtype).toBe('MULTIPOLYGON');
    });

    test('splitParcel cuts one parcel into two ~half pieces; original soft-deleted', async () => {
        const whole = await createParcel(ctx(), locationId, { name: 'To Split', geometry: rect(0.1, 0.1, 0.12, 0.12) });
        // Vertical blade at x=0.11, extending beyond the square top+bottom.
        const blade: LineString = { type: 'LineString', coordinates: [[0.11, 0.09], [0.11, 0.13]] };

        const res = await splitParcel(ctx(), whole.id, blade);
        expect(res.pieces).toHaveLength(2);
        for (const piece of res.pieces) {
            // Each half ≈ 50% of the whole (allow generous slack for ellipsoid area).
            expect(piece.areaHa!).toBeGreaterThan((whole.areaHa ?? 0) * 0.4);
            expect(piece.areaHa!).toBeLessThan((whole.areaHa ?? 0) * 0.6);
        }
        const original = await prisma.parcel.findUnique({ where: { id: whole.id }, select: { deletedAt: true } });
        expect(original!.deletedAt).not.toBeNull();

        // Both pieces are live, named after the parent.
        const liveNames = await prisma.parcel.findMany({
            where: { id: { in: res.pieces.map((p) => p.id) }, deletedAt: null },
            select: { name: true },
        });
        expect(liveNames).toHaveLength(2);
        expect(liveNames.every((p) => p.name.startsWith('To Split ('))).toBe(true);
    });

    test('rejects a blade that does not fully cross the parcel', async () => {
        const p = await createParcel(ctx(), locationId, { name: 'No Cut', geometry: rect(0.2, 0.2, 0.22, 0.22) });
        // A tiny segment wholly inside the parcel — divides nothing.
        const stub: LineString = { type: 'LineString', coordinates: [[0.205, 0.205], [0.208, 0.208]] };
        await expect(splitParcel(ctx(), p.id, stub)).rejects.toThrow(/fully cross/i);
        // The parcel is untouched (still live).
        const row = await prisma.parcel.findUnique({ where: { id: p.id }, select: { deletedAt: true } });
        expect(row!.deletedAt).toBeNull();
    });

    test('merge rejects an id that is not a parcel of this location', async () => {
        const a = await createParcel(ctx(), locationId, { name: 'M1', geometry: rect(0.3, 0.3, 0.31, 0.31) });
        await expect(
            mergeParcels(ctx(), locationId, [a.id, `nonexistent-${randomUUID()}`], 'Bad Merge'),
        ).rejects.toThrow(/not found/i);
        // The real parcel survives the rejected merge.
        const row = await prisma.parcel.findUnique({ where: { id: a.id }, select: { deletedAt: true } });
        expect(row!.deletedAt).toBeNull();
    });
});
