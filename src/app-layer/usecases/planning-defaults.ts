/**
 * Planning bootstrap defaults — the small starter data a brand-new tenant
 * needs so the crop-plan create flow works out of the box.
 *
 * A CropPlan requires a Season, and seasons were never seeded, so a fresh
 * tenant hit a dead `noSeasons` placeholder in the create-plan modal.
 * `seedDefaultSeason` closes that cold-start: it writes one sensible
 * default season (the current calendar year's main growing window) if the
 * tenant has none yet.
 *
 * Raw-Prisma (not the season usecase) on purpose — it runs at seed time
 * where there is no `RequestContext`, mirroring the seed-demo convention.
 * `prisma/seed.ts` calls it so the dev tenant opens with a working season.
 * Real tenants create their first season inline in the create-plan modal
 * (the season Combobox's "Create <name>" affordance mints a season with
 * the same current-year default window this helper uses) — that keeps the
 * cold-start fix off the auth-critical tenant-creation path. Idempotent on
 * the `default-season` natural key.
 */
import type { PrismaClient } from '@prisma/client';

export const DEFAULT_SEASON_KEY = 'default-season';

/**
 * Create the default season for a tenant if it doesn't already have one.
 * Returns the season id (existing or newly created). Idempotent.
 */
export async function seedDefaultSeason(db: PrismaClient, tenantId: string): Promise<string> {
    const existing = await db.season.findFirst({
        where: { tenantId, key: DEFAULT_SEASON_KEY },
        select: { id: true },
    });
    if (existing) return existing.id;

    const year = new Date().getUTCFullYear();
    const season = await db.season.create({
        data: {
            tenantId,
            key: DEFAULT_SEASON_KEY,
            name: `${year} Main Season`,
            year,
            // March 1 → October 31, the temperate main growing window
            // (matches the seed-demo default). UTC so any server computes
            // the same calendar dates.
            startDate: new Date(Date.UTC(year, 2, 1)),
            endDate: new Date(Date.UTC(year, 9, 31)),
            status: 'ACTIVE',
        },
        select: { id: true },
    });
    return season.id;
}
