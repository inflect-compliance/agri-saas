/**
 * Read-time soil hydration — DB-backed integration (real PostGIS).
 *
 * A parcel whose own `soilJson` is still null (the throttled async soil-fetch
 * job has not run yet) must nonetheless return soil INSTANTLY at read time
 * when its centroid's ~100 m grid cell is already present in the GLOBAL
 * `SoilSample` cache (a sibling parcel / a neighbouring field already sampled
 * it). This pins the `listLocationParcels` LEFT JOIN LATERAL against the exact
 * grid-cell arithmetic the job uses (`toE3 = round(deg × 1000)`), and proves
 * an un-sampled cell is NOT given fabricated soil.
 */
import { PrismaClient, Role, MembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Polygon } from 'geojson';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { hashForLookup } from '@/lib/security/encryption';
import { makeRequestContext } from '../helpers/make-context';
import { createParcel } from '@/app-layer/usecases/parcel';
import { listLocationParcels } from '@/app-layer/usecases/location';
import { env } from '@/env';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `soil-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;
let ownerId = '';
let locationId = '';
let seededCell: { latE3: number; lonE3: number } | null = null;

const ctx = () => makeRequestContext('OWNER', { userId: ownerId, tenantId: TENANT_ID, tenantSlug: TAG });

/** A small square inside Bulgaria's WGS84 envelope (lon ~25, lat ~42). */
function squareAt(lon: number, lat: number, size = 0.004): Polygon {
    return {
        type: 'Polygon',
        coordinates: [[
            [lon, lat],
            [lon, lat + size],
            [lon + size, lat + size],
            [lon + size, lat],
            [lon, lat],
        ]],
    };
}

const SAMPLE_PROFILE = { wrbClass: 'Chernozem', textureClass: 'clay', phH2o: 6.8 };

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
    // SoilSample is a global (tenant-less) table — remove the cell we seeded
    // so it can't bleed into another test's grid-cell assumptions.
    if (seededCell) {
        await prisma.soilSample.deleteMany({ where: { latE3: seededCell.latE3, lonE3: seededCell.lonE3 } });
    }
    await prisma.$disconnect();
});

describeFn('read-time soil hydration (PostGIS)', () => {
    test('a null-soil parcel hydrates from the global SoilSample cache at read time', async () => {
        const parcel = await createParcel(ctx(), locationId, { name: 'Cached cell', geometry: squareAt(25.001, 42.001) });

        // The centroid grid cell, computed exactly as the read query / job does.
        const [cell] = await prisma.$queryRawUnsafe<Array<{ latE3: number; lonE3: number; soilJson: unknown }>>(
            `SELECT floor(ST_Y(ST_Centroid("geometry")) * 1000 + 0.5)::int AS "latE3",
                    floor(ST_X(ST_Centroid("geometry")) * 1000 + 0.5)::int AS "lonE3",
                    "soilJson"
             FROM "Parcel" WHERE "id" = $1`,
            parcel.id,
        );
        // The parcel itself has no soil yet (the async job never runs here).
        expect(cell.soilJson).toBeNull();

        // Seed the GLOBAL cache for exactly this cell (as if a sibling parcel
        // had already triggered the provider fetch).
        seededCell = { latE3: cell.latE3, lonE3: cell.lonE3 };
        await prisma.soilSample.upsert({
            where: { latE3_lonE3: seededCell },
            create: { ...seededCell, provider: env.SOIL_PROVIDER, dataJson: SAMPLE_PROFILE },
            update: { provider: env.SOIL_PROVIDER, dataJson: SAMPLE_PROFILE },
        });

        const { parcels } = await listLocationParcels(ctx(), locationId);
        const row = parcels.find((p) => p.id === parcel.id);
        expect(row).toBeDefined();
        // Hydrated INSTANTLY from cache — no job, no provider call.
        expect(row!.soilJson).not.toBeNull();
        expect(row!.soilJson!.wrbClass).toBe('Chernozem');
        // Label derived from the cache, matching the job's soilTypeLabel (WRB wins).
        expect(row!.soilType).toBe('Chernozem');
    });

    test('a parcel whose cell is NOT cached stays null (no fabricated soil)', async () => {
        const parcel = await createParcel(ctx(), locationId, { name: 'Uncached cell', geometry: squareAt(26.5, 43.2) });
        const { parcels } = await listLocationParcels(ctx(), locationId);
        const row = parcels.find((p) => p.id === parcel.id);
        expect(row).toBeDefined();
        expect(row!.soilJson).toBeNull();
        expect(row!.soilType).toBeNull();
    });
});
