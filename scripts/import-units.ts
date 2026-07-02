/**
 * `npm run import:units` — seed the global unit-of-measure catalog.
 *
 * `Unit` is a GLOBAL catalog (no tenantId, no RLS): the same rows are
 * shared by every tenant. A spray dose is a RATE unit (e.g. "L/ha");
 * input-product default units are VOLUME / WEIGHT / COUNT. This script
 * is idempotent — it upserts by `key`, so re-running it is safe and
 * only fills gaps / refreshes labels.
 *
 *   npm run import:units            # apply
 *   npx tsx scripts/import-units.ts # equivalent direct invocation
 *
 * Exit codes: 0 = ok, 1 = fatal runtime error (DB unreachable, etc.).
 *
 * Licensing: the unit set is generic UOM data (no third-party catalog
 * copied), so there is nothing to attribute.
 */
process.env.SKIP_ENV_VALIDATION = '1';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { QuantityMeasure } from '@prisma/client';

interface UnitSeed {
    key: string;
    name: string;
    symbol: string;
    measure: QuantityMeasure;
}

/**
 * Curated base catalog. Keys are stable slugs (the schema comment's
 * "l-per-ha", "kg", "l" convention); symbols are the display labels.
 * RATE units are what a spray prescription dose uses.
 */
export const UNIT_SEEDS: UnitSeed[] = [
    // ── Area (field / parcel sizing) ──
    { key: 'ha', name: 'Hectare', symbol: 'ha', measure: 'AREA' },
    { key: 'm2', name: 'Square metre', symbol: 'm²', measure: 'AREA' },
    { key: 'ac', name: 'Acre', symbol: 'ac', measure: 'AREA' },
    // ── Volume (liquid products) ──
    { key: 'l', name: 'Litre', symbol: 'L', measure: 'VOLUME' },
    { key: 'ml', name: 'Millilitre', symbol: 'mL', measure: 'VOLUME' },
    // ── Weight (granular / dry products) ──
    { key: 'kg', name: 'Kilogram', symbol: 'kg', measure: 'WEIGHT' },
    { key: 'g', name: 'Gram', symbol: 'g', measure: 'WEIGHT' },
    { key: 't', name: 'Tonne', symbol: 't', measure: 'WEIGHT' },
    // ── Count ──
    { key: 'each', name: 'Each', symbol: 'ea', measure: 'COUNT' },
    // ── Length ──
    { key: 'm', name: 'Metre', symbol: 'm', measure: 'LENGTH' },
    { key: 'km', name: 'Kilometre', symbol: 'km', measure: 'LENGTH' },
    // ── Rate (application doses — the spray prescription unit) ──
    { key: 'l-per-ha', name: 'Litres per hectare', symbol: 'L/ha', measure: 'RATE' },
    { key: 'ml-per-ha', name: 'Millilitres per hectare', symbol: 'mL/ha', measure: 'RATE' },
    { key: 'kg-per-ha', name: 'Kilograms per hectare', symbol: 'kg/ha', measure: 'RATE' },
    { key: 'g-per-ha', name: 'Grams per hectare', symbol: 'g/ha', measure: 'RATE' },
    // Per-decare rates (1 ha = 10 dca) — the Bulgarian field standard, and
    // the basis the per-parcel spray calculator multiplies against.
    { key: 'l-per-dca', name: 'Litres per decare', symbol: 'L/dca', measure: 'RATE' },
    { key: 'ml-per-dca', name: 'Millilitres per decare', symbol: 'mL/dca', measure: 'RATE' },
    { key: 'kg-per-dca', name: 'Kilograms per decare', symbol: 'kg/dca', measure: 'RATE' },
    { key: 'g-per-dca', name: 'Grams per decare', symbol: 'g/dca', measure: 'RATE' },
    // ── Other (concentration) ──
    { key: 'pct', name: 'Percent', symbol: '%', measure: 'OTHER' },
];

/** Upsert every unit; returns {created, updated}. Exported for tests. */
export async function importUnits(
    prisma: Pick<PrismaClient, 'unit'>,
    seeds: UnitSeed[] = UNIT_SEEDS,
): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const u of seeds) {
        const existing = await prisma.unit.findUnique({ where: { key: u.key } });
        await prisma.unit.upsert({
            where: { key: u.key },
            create: { key: u.key, name: u.name, symbol: u.symbol, measure: u.measure },
            update: { name: u.name, symbol: u.symbol, measure: u.measure },
        });
        if (existing) updated += 1;
        else created += 1;
    }
    return { created, updated };
}

async function main(): Promise<number> {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
    const prisma = new PrismaClient({ adapter });
    try {
        const { created, updated } = await importUnits(prisma);
        process.stdout.write(
            `${JSON.stringify({ ok: true, units: UNIT_SEEDS.length, created, updated }, null, 2)}\n`,
        );
        return 0;
    } catch (err) {
        process.stderr.write(
            `import:units failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return 1;
    } finally {
        await prisma.$disconnect();
    }
}

// Only run when invoked directly (not when imported by a test).
if (require.main === module) {
    main().then(
        (code) => process.exit(code),
        (err) => {
            process.stderr.write(`${String(err)}\n`);
            process.exit(1);
        },
    );
}
