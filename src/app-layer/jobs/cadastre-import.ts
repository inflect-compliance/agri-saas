/**
 * КАИС cadastre OpenData import — off-thread job.
 *
 * Enqueued by `stageLocationCadastreImport` with a list of cadastral
 * identifiers (ЕКАТТЕ.масив.номер). The worker:
 *   1. groups the identifiers by their 5-digit ЕКАТТЕ (the settlement archive
 *      that must be fetched);
 *   2. for each ЕКАТТЕ, resolves the land-parcels ZIP CACHE-FIRST — a fresh
 *      global `CadastreArchive` row (within the TTL) reuses the stored ZIP;
 *      otherwise it fetches from КАИС OpenData (`CadastreOpenDataClient`),
 *      stores the bytes, and upserts the archive row;
 *   3. parses the shapefile ZIP (`parseShapefileZip`) and selects only the
 *      features whose parsed `cadastralId` was requested;
 *   4. STRIPS owner-ish attributes (privacy) from every selected feature;
 *   5. appends them to the location via `ParcelRepository.addParcelsForLocation`
 *      — reprojecting КС2005 (7801) / UTM 35N (32635) metres to WGS84 via the
 *      Part A source-SRID resolution (a resolved `.prj`, else the PostGIS
 *      probe);
 *   6. reports which requested identifiers were NOT found.
 *
 * PRIVACY: only the land-parcels archive is fetched; the client refuses
 * ownership registers, and the strip is a defence-in-depth backstop.
 *
 * Non-retrying (`attempts: 1`). Import is ADDITIVE (existing parcels kept).
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { getStorageProvider } from '@/lib/storage';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';
import { runInTenantContext } from '@/lib/db-context';
import { parseShapefileZip, type ParsedParcel } from '@/lib/spatial/parse';
import { assertParcelComplexity, SpatialLimitError } from '@/lib/spatial/limits';
import { ParcelRepository } from '@/app-layer/repositories/ParcelRepository';
import { logEvent } from '@/app-layer/events/audit';
import { computePermissions } from '@/lib/tenant-context';
import { getPermissionsForRole, parsePermissionsJson } from '@/lib/permissions';
import { CadastreOpenDataClient } from '@/lib/cadastre/opendata-client';
import { groupByEkatte } from '@/lib/cadastre/identifier';
import { stripOwnerAttributes } from '@/lib/cadastre/privacy';
import type { RequestContext } from '@/app-layer/types';
import type { CadastreImportJobPayload } from './types';

/** Reuse a cached settlement archive fetched within this many days. */
const CADASTRE_ARCHIVE_TTL_DAYS = 14;

export interface CadastreImportJobResult {
    tenantId: string;
    locationId: string;
    requested: number;
    /** Parcels created (features that matched a requested identifier). */
    imported: number;
    /** Requested identifiers with no matching feature / settlement. */
    notFound: string[];
    /** ЕКАТТЕ archives served from cache vs freshly fetched. */
    ekatteCached: string[];
    ekatteFetched: string[];
    bounds: [number, number, number, number] | null;
    jobRunId: string;
}

/** Build the job's RequestContext from the requester's ACTIVE membership. */
async function buildJobContext(payload: CadastreImportJobPayload): Promise<RequestContext> {
    const membership = await prisma.tenantMembership.findFirst({
        where: { userId: payload.initiatedByUserId, tenantId: payload.tenantId, status: 'ACTIVE' },
        include: { customRole: true },
    });
    if (!membership) {
        throw new Error(
            `cadastre-import: user ${payload.initiatedByUserId} is not an active member of tenant ${payload.tenantId}`,
        );
    }
    const effectiveRole = membership.customRole?.baseRole ?? membership.role;
    const appPermissions = membership.customRole
        ? parsePermissionsJson(membership.customRole.permissionsJson, membership.customRole.baseRole)
        : getPermissionsForRole(membership.role);
    return {
        requestId: payload.requestId ?? `cadastre-import-${payload.tenantId}`,
        userId: payload.initiatedByUserId,
        tenantId: payload.tenantId,
        role: effectiveRole,
        permissions: computePermissions(effectiveRole),
        appPermissions,
    };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks);
}

/** Are the parcels' coordinates in projected metres (magnitude ≫ WGS84 range)? */
function looksProjected(parcels: ReadonlyArray<ParsedParcel>): boolean {
    for (const p of parcels.slice(0, 4)) {
        for (const poly of p.geometry.coordinates) {
            for (const ring of poly) {
                for (const [x, y] of ring) {
                    if (Math.abs(x) > 180 || Math.abs(y) > 90) return true;
                }
            }
        }
    }
    return false;
}

/**
 * Resolve + cache the land-parcels ZIP for one ЕКАТТЕ. Returns the bytes plus
 * whether they came from cache. Cache-first: a `CadastreArchive` row fetched
 * within the TTL reuses the stored ZIP.
 */
async function resolveArchive(
    client: CadastreOpenDataClient,
    ekatte: string,
): Promise<{ buffer: Buffer; cached: boolean }> {
    const storage = getStorageProvider();
    const existing = await prisma.cadastreArchive.findUnique({ where: { ekatte } });
    const now = Date.now();
    if (existing && now - existing.fetchedAt.getTime() < CADASTRE_ARCHIVE_TTL_DAYS * 86_400_000) {
        try {
            const buffer = await streamToBuffer(storage.readStream(existing.storageKey));
            if (buffer.byteLength > 0) return { buffer, cached: true };
        } catch (err) {
            logger.warn('cadastre-import.cache_read_failed', {
                component: 'cadastre-import',
                ekatte,
                error: err instanceof Error ? err.message : String(err),
            });
            // fall through to a fresh fetch
        }
    }

    const fetched = await client.fetchArchive(ekatte);
    // GLOBAL cache key (no tenant — the archive is public data shared across
    // tenants, like SoilSample). Written through the storage abstraction.
    const storageKey = `cadastre-opendata/${ekatte}/${crypto.randomUUID()}.zip`;
    const writeResult = await storage.write(storageKey, fetched.buffer, { mimeType: 'application/zip' });
    await prisma.cadastreArchive.upsert({
        where: { ekatte },
        create: {
            ekatte,
            sourceDate: new Date(fetched.sourceDate),
            storageKey,
            sizeBytes: writeResult.sizeBytes,
            sourcePath: fetched.sourcePath,
            fetchedAt: new Date(),
        },
        update: {
            sourceDate: new Date(fetched.sourceDate),
            storageKey,
            sizeBytes: writeResult.sizeBytes,
            sourcePath: fetched.sourcePath,
            fetchedAt: new Date(),
        },
    });
    return { buffer: fetched.buffer, cached: false };
}

/** Job entry point — fetch + parse + select + persist requested parcels. */
export async function runCadastreImport(
    payload: CadastreImportJobPayload,
): Promise<CadastreImportJobResult> {
    const jobRunId = crypto.randomUUID();
    return runJob('cadastre-import', async () => {
        if (!env.CADASTRE_OPENDATA_INDEX_URL) {
            throw new Error('cadastre-import: CADASTRE_OPENDATA_INDEX_URL is not configured.');
        }
        const ctx = await buildJobContext(payload);
        if (!ctx.permissions.canWrite) {
            throw new Error(
                `cadastre-import: user ${payload.initiatedByUserId} lacks write permission on tenant ${payload.tenantId}`,
            );
        }

        const client = new CadastreOpenDataClient({ baseUrl: env.CADASTRE_OPENDATA_INDEX_URL });
        const groups = groupByEkatte(payload.identifiers);
        const requestedSet = new Set(payload.identifiers);
        const matched = new Set<string>();
        const selected: ParsedParcel[] = [];
        const ekatteCached: string[] = [];
        const ekatteFetched: string[] = [];
        // Source SRID resolved from a shapefile `.prj` (КАИС ships КС2005/7801).
        // Preferred over the probe; the probe is the prj-less fallback.
        let detectedSrid: number | undefined;

        for (const [ekatte, ids] of groups) {
            const idSet = new Set(ids);
            let archive: { buffer: Buffer; cached: boolean };
            try {
                archive = await resolveArchive(client, ekatte);
            } catch (err) {
                logger.warn('cadastre-import.archive_unresolved', {
                    component: 'cadastre-import',
                    tenantId: ctx.tenantId,
                    ekatte,
                    error: err instanceof Error ? err.message : String(err),
                });
                continue; // its identifiers stay in notFound
            }
            (archive.cached ? ekatteCached : ekatteFetched).push(ekatte);

            const { parcels, srid } = await parseShapefileZip(archive.buffer);
            if (srid !== undefined) detectedSrid = srid;
            for (const p of parcels) {
                if (p.cadastralId && idSet.has(p.cadastralId)) {
                    matched.add(p.cadastralId);
                    selected.push({ ...p, properties: stripOwnerAttributes(p.properties) });
                }
            }
        }

        const notFound = payload.identifiers.filter((id) => !matched.has(id));

        if (selected.length === 0) {
            logger.info('cadastre-import.no_matches', {
                component: 'cadastre-import',
                tenantId: ctx.tenantId,
                locationId: payload.locationId,
                requested: requestedSet.size,
            });
            return {
                tenantId: ctx.tenantId,
                locationId: payload.locationId,
                requested: requestedSet.size,
                imported: 0,
                notFound,
                ekatteCached,
                ekatteFetched,
                bounds: null,
                jobRunId,
            };
        }

        // Complexity caps (pure, pre-persist) — same bound as the upload path.
        assertParcelComplexity(selected);

        const { imported, bounds } = await runInTenantContext(ctx, async (db) => {
            const location = await db.location.findFirst({
                where: { id: payload.locationId, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!location) {
                throw new Error(`cadastre-import: location ${payload.locationId} not found for tenant ${ctx.tenantId}`);
            }

            // Topology check over every selected geometry (raw — SRID-independent).
            let invalidNames: string[];
            try {
                invalidNames = await ParcelRepository.findInvalidGeometryNames(db, selected);
            } catch (err) {
                logger.warn('cadastre-import.geometry_parse_rejected', {
                    component: 'cadastre-import',
                    tenantId: ctx.tenantId,
                    error: err instanceof Error ? err.message : String(err),
                });
                throw new SpatialLimitError('Cadastre import contains malformed geometry.', 422);
            }
            if (invalidNames.length > 0) {
                const preview = invalidNames.slice(0, 5).join(', ');
                throw new SpatialLimitError(
                    `Cadastre import contains ${invalidNames.length} invalid (self-intersecting) parcel(s): ${preview}.`,
                    422,
                );
            }

            // Resolve the source SRID. КАИС land-parcels ship КС2005 (7801),
            // usually WITH a .prj (`detectedSrid`). Prefer that; only when the
            // coordinates are projected metres AND no .prj resolved them, PROBE
            // 7801 vs 32635 by which transforms inside Bulgaria (Part A).
            let sourceSrid: number | undefined = detectedSrid;
            if (sourceSrid === undefined && looksProjected(selected)) {
                sourceSrid = (await ParcelRepository.probeSourceSrid(db, selected)) ?? undefined;
                if (sourceSrid === undefined) {
                    throw new SpatialLimitError(
                        'Cadastre features are in projected metres but the source CRS (КС2005 / UTM 35N) ' +
                            'could not be resolved by reprojection.',
                        422,
                    );
                }
            }

            const parcelIds = await ParcelRepository.addParcelsForLocation(
                db,
                ctx,
                payload.locationId,
                selected,
                undefined,
                sourceSrid,
            );
            const fullBounds = await ParcelRepository.boundsForLocation(db, ctx, payload.locationId);
            await db.location.update({
                where: { id: payload.locationId },
                data: {
                    spatialFormat: 'shapefile',
                    boundsJson: fullBounds
                        ? (fullBounds as unknown as Prisma.InputJsonValue)
                        : Prisma.JsonNull,
                },
            });

            await logEvent(db, ctx, {
                action: 'LOCATION_SPATIAL_IMPORTED',
                entityType: 'Location',
                entityId: payload.locationId,
                details: `Imported ${parcelIds.length} parcels from КАИС cadastre`,
                detailsJson: {
                    category: 'entity_lifecycle',
                    entityName: 'Location',
                    operation: 'updated',
                    after: { source: 'kais-opendata', parcelCount: parcelIds.length },
                    summary: `Imported ${parcelIds.length} cadastre parcels (${matched.size} identifiers)`,
                },
            });

            return { imported: parcelIds.length, bounds: fullBounds, parcelIds };
        });

        // Best-effort soil fetch for the imported parcels (never blocks).
        try {
            const { enqueueParcelSoilFetch } = await import('@/app-layer/usecases/soil');
            const created = await runInTenantContext(ctx, (db) =>
                db.parcel.findMany({
                    where: { locationId: payload.locationId, tenantId: ctx.tenantId, deletedAt: null },
                    orderBy: { createdAt: 'desc' },
                    take: imported,
                    select: { id: true },
                }),
            );
            await enqueueParcelSoilFetch(ctx, created.map((p) => p.id));
        } catch {
            /* soil fetch is best-effort */
        }

        // Best-effort legal-entity ownership population for the imported
        // settlements (global CadastreOwner cache, TTL-guarded; parcels surface
        // the owner via a read-time join on cadastralId). Never blocks the
        // import; personal data is dropped in the extractor, never persisted.
        try {
            const { fetchAndStoreCadastreOwners } = await import('@/app-layer/usecases/cadastre-owners');
            for (const ekatte of new Set([...ekatteFetched, ...ekatteCached])) {
                await fetchAndStoreCadastreOwners(ekatte).catch(() => undefined);
            }
        } catch {
            /* ownership population is best-effort */
        }

        logger.info('cadastre-import.completed', {
            component: 'cadastre-import',
            tenantId: ctx.tenantId,
            locationId: payload.locationId,
            jobRunId,
            imported,
            notFound: notFound.length,
        });

        return {
            tenantId: ctx.tenantId,
            locationId: payload.locationId,
            requested: requestedSet.size,
            imported,
            notFound,
            ekatteCached,
            ekatteFetched,
            bounds,
            jobRunId,
        };
    }, { tenantId: payload.tenantId });
}
