/**
 * Vector-tile generation — DB-backed integration (real PostGIS MVT).
 *
 * Proves `getLocationParcelTile` (ST_AsMVT / ST_AsMVTGeom / ST_TileEnvelope
 * via the geo helper):
 *   1. A tile covering a parcel returns a non-empty protobuf buffer.
 *   2. A far-away tile returns an empty buffer (the route answers 204).
 *   3. Tenant isolation — tenant B can never render tenant A's parcels.
 *   4. ST_Simplify export path returns parcels with fewer-or-equal vertices
 *      and the same areaHa (display fidelity preserved, area unaffected).
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Polygon } from 'geojson';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createParcel } from '@/app-layer/usecases/parcel';
import { getLocationParcelTile, listLocationParcels } from '@/app-layer/usecases/location';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `tiles-${randomUUID().slice(0, 8)}`;
const TENANT_A = `ta-${TAG}`;
const TENANT_B = `tb-${TAG}`;
let ownerA = '';
let ownerB = '';
let locationA = '';

const ctxA = () => makeRequestContext('OWNER', { userId: ownerA, tenantId: TENANT_A, tenantSlug: `${TAG}-a` });
const ctxB = () => makeRequestContext('OWNER', { userId: ownerB, tenantId: TENANT_B, tenantSlug: `${TAG}-b` });

// A ~1 km square near (10°E, 50°N) — clear of the equator/antimeridian
// tile seams so the web-mercator tile address is unambiguous.
const PARCEL: Polygon = {
    type: 'Polygon',
    coordinates: [[[10, 50], [10.01, 50], [10.01, 50.01], [10, 50.01], [10, 50]]],
};

// Standard web-mercator tile address of a lon/lat at zoom z.
const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
};

async function seedTenant(tenantId: string, slug: string): Promise<{ ownerId: string }> {
    await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: tenantId, slug } });
    const u = await prisma.user.create({ data: { email: `${slug}@example.test`, emailHash: hashForLookup(`${slug}@example.test`) } });
    await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: Role.OWNER, status: MembershipStatus.ACTIVE } });
    return { ownerId: u.id };
}

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    ownerA = (await seedTenant(TENANT_A, `${TAG}-a`)).ownerId;
    ownerB = (await seedTenant(TENANT_B, `${TAG}-b`)).ownerId;
    const locA = await prisma.location.create({ data: { tenantId: TENANT_A, name: 'Tile Field A' } });
    locationA = locA.id;
    await createParcel(ctxA(), locationA, { name: 'North 40', geometry: PARCEL });
}, 60_000);

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        await prisma.parcel.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
        await prisma.location.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
        await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
        await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
        await prisma.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
    } catch {
        /* best effort */
    }
    await prisma.$disconnect();
});

describeFn('parcel vector tiles (PostGIS MVT)', () => {
    const z = 12;
    const tx = lon2tile(10.005, z);
    const ty = lat2tile(50.005, z);

    test('a tile covering the parcel returns a non-empty MVT buffer', async () => {
        const tile = await getLocationParcelTile(ctxA(), locationA, z, tx, ty);
        expect(Buffer.isBuffer(tile)).toBe(true);
        expect(tile.length).toBeGreaterThan(0);
    });

    test('a far-away tile returns an empty buffer', async () => {
        // Antipodal-ish tile that the parcel cannot touch.
        const tile = await getLocationParcelTile(ctxA(), locationA, z, 0, 0);
        expect(tile.length).toBe(0);
    });

    test('tenant isolation — tenant B cannot render tenant A parcels', async () => {
        const tile = await getLocationParcelTile(ctxB(), locationA, z, tx, ty);
        expect(tile.length).toBe(0);
    });

    test('ST_Simplify export keeps areaHa and never adds vertices', async () => {
        const full = await listLocationParcels(ctxA(), locationA);
        const simplified = await listLocationParcels(ctxA(), locationA, { simplifyTolerance: 0.001 });
        expect(simplified.parcels).toHaveLength(full.parcels.length);

        const countVertices = (g: unknown): number => {
            const geom = g as { type?: string; coordinates?: number[][][][] } | null;
            if (!geom || geom.type !== 'MultiPolygon' || !geom.coordinates) return 0;
            return geom.coordinates.flat(2).length;
        };
        const fullV = countVertices(full.parcels[0]?.geometry);
        const simpV = countVertices(simplified.parcels[0]?.geometry);
        expect(simpV).toBeLessThanOrEqual(fullV);
        // areaHa is derived from the exact geometry, not the simplified one.
        expect(simplified.parcels[0]?.areaHa).toBe(full.parcels[0]?.areaHa);
    });
});
