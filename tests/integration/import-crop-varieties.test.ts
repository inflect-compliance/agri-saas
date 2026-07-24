/**
 * `importCropVarieties` — DB-backed integration test.
 *
 * Mirrors the importer-test convention of framework-import-cli.test.ts:
 *   • the expanded catalog seeds the expected MAGNITUDE (≥25 crop types,
 *     ≥60 varieties) into a fresh tenant, every variety carrying its
 *     CC0 `sourceUrn` provenance + the full agronomic field set;
 *   • a SECOND run is fully idempotent (varietiesCreated = 0,
 *     cropTypesCreated = 0, skipped > 0) — the CropType (tenantId,key) +
 *     CropVariety (tenantId,cropTypeId,key) upserts re-skip every row.
 *
 * The crop catalog tables are NOT truncated by resetDatabase(), so the
 * test scopes every assertion to its own tagged tenant and tears the
 * tenant-scoped rows down in afterAll.
 *
 * Skipped when DB is unavailable.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import { DB_URL, DB_AVAILABLE } from './db-helper';
import { importCropVarieties, CROP_VARIETIES } from '../../scripts/import-crop-varieties';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = `cropvar-${randomUUID().slice(0, 8)}`;
const TENANT_ID = `t-${TAG}`;

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await prisma.$connect();
    await prisma.tenant.upsert({
        where: { id: TENANT_ID },
        update: {},
        create: { id: TENANT_ID, name: TENANT_ID, slug: TAG },
    });
});

afterAll(async () => {
    if (!DB_AVAILABLE) return;
    try {
        // Children first (CropVariety FK → CropType), then the tenant.
        await prisma.cropVariety.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.cropType.deleteMany({ where: { tenantId: TENANT_ID } });
        await prisma.tenant.delete({ where: { id: TENANT_ID } });
    } catch {
        /* globalSetup handles reset */
    }
    await prisma.$disconnect();
});

describeFn('importCropVarieties (DB)', () => {
    test('the catalog source itself is sized + internally consistent', () => {
        const totalVarieties = CROP_VARIETIES.reduce((n, c) => n + c.varieties.length, 0);
        expect(CROP_VARIETIES.length).toBeGreaterThanOrEqual(25);
        expect(totalVarieties).toBeGreaterThanOrEqual(60);

        // Crop-type keys are globally unique; variety keys globally unique.
        const ctKeys = CROP_VARIETIES.map((c) => c.cropType.key);
        expect(new Set(ctKeys).size).toBe(ctKeys.length);
        const varKeys = CROP_VARIETIES.flatMap((c) => c.varieties.map((v) => v.key));
        expect(new Set(varKeys).size).toBe(varKeys.length);

        // Every crop type carries ≥1 variety.
        for (const c of CROP_VARIETIES) {
            expect(c.varieties.length).toBeGreaterThanOrEqual(1);
        }
    });

    test('first run seeds the full catalog into the tenant', async () => {
        const res = await importCropVarieties(prisma, { tenantId: TENANT_ID });

        expect(res.tenantId).toBe(TENANT_ID);
        expect(res.cropTypesCreated).toBeGreaterThanOrEqual(25);
        expect(res.varietiesCreated).toBeGreaterThanOrEqual(60);

        // Persisted rows match the import counts exactly (fresh tenant).
        const cropTypeCount = await prisma.cropType.count({ where: { tenantId: TENANT_ID } });
        const varietyCount = await prisma.cropVariety.count({ where: { tenantId: TENANT_ID } });
        expect(cropTypeCount).toBe(res.cropTypesCreated);
        expect(varietyCount).toBe(res.varietiesCreated);
        expect(cropTypeCount).toBe(CROP_VARIETIES.length);
        expect(varietyCount).toBe(
            CROP_VARIETIES.reduce((n, c) => n + c.varieties.length, 0),
        );
    });

    test('multiple varieties land under a single crop type', async () => {
        const tomato = await prisma.cropType.findFirst({
            where: { tenantId: TENANT_ID, key: 'tomato' },
            select: { id: true },
        });
        expect(tomato).not.toBeNull();
        const tomatoVarieties = await prisma.cropVariety.count({
            where: { tenantId: TENANT_ID, cropTypeId: tomato!.id },
        });
        // Tomato has cherry/beefsteak/paste/heirloom — well over one.
        expect(tomatoVarieties).toBeGreaterThanOrEqual(3);
    });

    test('every variety carries CC0 provenance + the agronomic field set', async () => {
        const varieties = await prisma.cropVariety.findMany({
            where: { tenantId: TENANT_ID },
            select: {
                sourceUrn: true,
                daysToMaturity: true,
                inRowSpacingCm: true,
                germinationRate: true,
                defaultMethod: true,
            },
        });
        expect(varieties.length).toBeGreaterThanOrEqual(60);
        for (const v of varieties) {
            expect(v.sourceUrn).toBe('openfarm:cc0');
            expect(v.daysToMaturity).toBeGreaterThan(0);
            expect(v.inRowSpacingCm).not.toBeNull();
            expect(v.germinationRate).not.toBeNull();
            expect(['DIRECT_SOW', 'TRANSPLANT']).toContain(v.defaultMethod);
        }
    });

    test('varieties carry the soil + GDD defaults the board surfaces', async () => {
        // A tomato variety should carry curated soil preferences (feeds the
        // suitability engine) + per-crop GDD params (feeds maturity %).
        const cherry = await prisma.cropVariety.findFirst({
            where: { tenantId: TENANT_ID, key: 'tomato-cherry' },
            select: { soilDefaultsJson: true, gddBaseC: true, gddToMaturity: true, daysToMaturity: true },
        });
        expect(cherry).not.toBeNull();
        const soil = cherry!.soilDefaultsJson as { phMin?: number; texturePreference?: string[] } | null;
        expect(soil?.phMin).toBeGreaterThan(0);
        expect(Array.isArray(soil?.texturePreference)).toBe(true);
        // Tomato base 10 °C; target scales with days-to-maturity (× 14/day).
        expect(Number(cherry!.gddBaseC)).toBe(10);
        expect(cherry!.gddToMaturity).toBe(Math.round((cherry!.daysToMaturity ?? 0) * 14));

        // Every crop in the catalog is in CROP_AGRO_DEFAULTS, so every
        // variety gets a GDD base temp.
        const withGdd = await prisma.cropVariety.count({
            where: { tenantId: TENANT_ID, gddBaseC: { not: null } },
        });
        const total = await prisma.cropVariety.count({ where: { tenantId: TENANT_ID } });
        expect(withGdd).toBe(total);
    });

    test('second run is fully idempotent', async () => {
        const before = {
            cropTypes: await prisma.cropType.count({ where: { tenantId: TENANT_ID } }),
            varieties: await prisma.cropVariety.count({ where: { tenantId: TENANT_ID } }),
        };

        const res = await importCropVarieties(prisma, { tenantId: TENANT_ID });
        expect(res.cropTypesCreated).toBe(0);
        expect(res.varietiesCreated).toBe(0);
        expect(res.skipped).toBeGreaterThan(0);
        expect(res.skipped).toBe(before.varieties);

        // No new rows.
        expect(await prisma.cropType.count({ where: { tenantId: TENANT_ID } })).toBe(before.cropTypes);
        expect(await prisma.cropVariety.count({ where: { tenantId: TENANT_ID } })).toBe(before.varieties);
    });
});
