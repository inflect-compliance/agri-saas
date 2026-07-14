/**
 * КАИС legal-entity ownership population.
 *
 * Fetches a settlement's „собственост ПИ" register, keeps ONLY legal entities
 * (readable name + numeric ЕИК — see `lib/cadastre/ownership.ts`; every physical
 * person is dropped there and never reaches this module), and replaces that
 * settlement's rows in the GLOBAL `CadastreOwner` cache. Parcels surface their
 * owner at read time by joining on `cadastralId` (no per-parcel fetch), the same
 * global-cache shape as `CadastreArchive` / `SoilSample`.
 *
 * `CadastreOwner` has no tenantId / no RLS, so this uses the base `prisma`
 * client directly (like `cadastreArchive` upserts) — no tenant transaction.
 * Best-effort by contract: a КАИС hiccup must never fail the geometry import
 * that triggers it.
 */
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { CadastreOpenDataClient } from '@/lib/cadastre/opendata-client';
import { extractCompanyOwnersFromZip } from '@/lib/cadastre/ownership';
import { logger } from '@/lib/observability/logger';

/** Ownership registers refresh on a ~2–4 week КАИС cycle; re-fetch after 14 days. */
const OWNER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type CadastreOwnersOutcome =
    | { status: 'disabled' }
    | { status: 'fresh' }
    | { status: 'stored'; count: number };

/** True when the КАИС OpenData feature is configured (server-only URL present). */
export function isCadastreOwnersEnabled(): boolean {
    return Boolean(env.CADASTRE_OPENDATA_INDEX_URL);
}

/**
 * Fetch + store the LEGAL-ENTITY owners for one settlement (ЕКАТТЕ). Skips when
 * the feature is disabled or the settlement's owners are still fresh (within the
 * TTL). Replaces the settlement's rows atomically (delete-then-insert) so a
 * parcel never briefly loses its owner mid-refresh. Physical persons are never
 * fetched into the DB — the extractor drops them before this point.
 */
export async function fetchAndStoreCadastreOwners(
    ekatte: string,
    opts: { force?: boolean } = {},
): Promise<CadastreOwnersOutcome> {
    const baseUrl = env.CADASTRE_OPENDATA_INDEX_URL;
    if (!baseUrl) return { status: 'disabled' };

    if (!opts.force) {
        const fresh = await prisma.cadastreOwner.findFirst({
            where: { ekatte, fetchedAt: { gt: new Date(Date.now() - OWNER_TTL_MS) } },
            select: { id: true },
        });
        if (fresh) return { status: 'fresh' };
    }

    const client = new CadastreOpenDataClient({ baseUrl });
    const archive = await client.fetchOwnershipArchive(ekatte);
    const owners = await extractCompanyOwnersFromZip(archive.buffer);
    const sourceDate = new Date(archive.sourceDate);

    // Replace-all for this settlement in one transaction: no window where a
    // parcel's owner is missing, and stale rows (owners removed upstream) are
    // dropped. `owners` is already de-duplicated on (cadastralId, eik, rightType).
    await prisma.$transaction([
        prisma.cadastreOwner.deleteMany({ where: { ekatte } }),
        prisma.cadastreOwner.createMany({
            data: owners.map((o) => ({
                cadastralId: o.cadastralId,
                ekatte,
                eik: o.eik,
                name: o.name,
                rightType: o.rightType ?? '',
                subjectKind: o.subjectKind,
                sourceDate,
            })),
            skipDuplicates: true,
        }),
    ]);

    logger.info('cadastre owners populated', {
        component: 'cadastre-owners',
        ekatte,
        legalEntities: owners.length,
    });
    return { status: 'stored', count: owners.length };
}
