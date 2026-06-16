/**
 * Spatial-upload abuse hardening — off-thread parcel-boundary import.
 *
 * Triggered by `POST /api/t/:slug/locations/:id/spatial-import`. The
 * HTTP layer enforces the per-format byte cap, stages the upload to
 * storage (domain `spatial`), records a FileRecord, and enqueues this
 * job. The worker does the expensive, attacker-influenced work where a
 * slow job is the norm — never on the request thread.
 *
 * ## Why not parse synchronously inside the request
 *
 * `ST_GeomFromGeoJSON` / `ST_Area` cost scales with vertex count, and
 * `shpjs` decompresses + reprojects a whole shapefile in-process. A
 * hostile (or merely huge) upload could pin a CPU for seconds — every
 * other request on that instance would stall. Moving the parse to BullMQ
 * isolates that cost.
 *
 * ## Defence layers (in order)
 *
 *   1. **Per-format byte cap** — enforced at the HTTP boundary BEFORE
 *      staging (shapefile 5 MB / GeoJSON·KML 10 MB). The densest format
 *      gets the tightest cap. (`assertUploadWithinSize`.)
 *   2. **30s parse budget** — the parse runs under a wall-clock race so
 *      the async shapefile path can never run away. The byte cap is the
 *      real CPU bound (parsing ≤10 MB is sub-second); the budget is the
 *      belt-and-braces backstop.
 *   3. **Parcel-complexity caps** — max parcels, max vertices per
 *      parcel, max vertices total. Checked AFTER parse, BEFORE persist,
 *      pure + DB-free. (`assertParcelComplexity`.)
 *   4. **Topology validation** — every parcel's geometry is run through
 *      a single batched `ST_IsValid` query; a self-intersecting polygon
 *      fails the WHOLE import closed (it would otherwise yield a
 *      meaningless `ST_Area`). (`ParcelRepository.findInvalidGeometryNames`.)
 *
 * Only after all four pass does `replaceForLocation` run.
 *
 * ## Idempotency
 *
 * Non-retrying (`attempts: 1`). `replaceForLocation` is itself
 * idempotent (delete-all-then-insert), so a manual re-trigger after a
 * transient failure reproduces the same end state. A hard reject (cap /
 * topology / budget) is surfaced via `failedReason` to the upload modal;
 * the staged file is left in place for the operator to re-trigger or
 * delete.
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getStorageProvider } from '@/lib/storage';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';
import { runInTenantContext } from '@/lib/db-context';
import { parseSpatialFile, type ParseResult } from '@/lib/spatial/parse';
import {
    SPATIAL_PARSE_TIMEOUT_MS,
    SpatialLimitError,
    assertParcelComplexity,
} from '@/lib/spatial/limits';
import { ParcelRepository } from '@/app-layer/repositories/ParcelRepository';
import { logEvent } from '@/app-layer/events/audit';
import { computePermissions } from '@/lib/tenant-context';
import { getPermissionsForRole, parsePermissionsJson } from '@/lib/permissions';
import type { RequestContext } from '@/app-layer/types';
import type { SpatialImportJobPayload } from './types';

export interface SpatialImportJobResult {
    tenantId: string;
    locationId: string;
    fileRecordId: string;
    format: string;
    parcelCount: number;
    bounds: [number, number, number, number] | null;
    skipped: number;
    jobRunId: string;
}

/**
 * Build the job's RequestContext from the uploader's ACTIVE membership,
 * mirroring `resolveTenantContext` (custom-role baseRole + permission
 * derivation) so the off-thread write applies the SAME authorization as
 * the synchronous path would have.
 */
async function buildJobContext(payload: SpatialImportJobPayload): Promise<RequestContext> {
    const membership = await prisma.tenantMembership.findFirst({
        where: {
            userId: payload.initiatedByUserId,
            tenantId: payload.tenantId,
            status: 'ACTIVE',
        },
        include: { customRole: true },
    });
    if (!membership) {
        throw new Error(
            `spatial-import: user ${payload.initiatedByUserId} is not an active member of tenant ${payload.tenantId}`,
        );
    }
    const effectiveRole = membership.customRole?.baseRole ?? membership.role;
    const appPermissions = membership.customRole
        ? parsePermissionsJson(membership.customRole.permissionsJson, membership.customRole.baseRole)
        : getPermissionsForRole(membership.role);
    return {
        requestId: payload.requestId ?? `spatial-import-${payload.tenantId}`,
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

/**
 * Parse under a hard wall-clock budget. JS is single-threaded, so this
 * race cannot pre-empt a synchronous CPU spin — but the per-format byte
 * cap already bounds the synchronous JSON/KML parse to sub-second, and
 * the shapefile path (`shpjs`) is genuinely async, so the timeout is a
 * real backstop for the one path that can stall.
 */
async function parseWithBudget(args: {
    filename: string;
    buffer: Buffer;
    mimeType?: string;
}): Promise<ParseResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(
                new SpatialLimitError(
                    `Parsing exceeded the ${SPATIAL_PARSE_TIMEOUT_MS / 1000}s budget. Simplify or split the upload.`,
                    422,
                ),
            );
        }, SPATIAL_PARSE_TIMEOUT_MS);
    });
    try {
        return await Promise.race([parseSpatialFile(args), budget]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Job entry point — parse + validate + persist a staged spatial upload.
 */
export async function runLocationSpatialImport(
    payload: SpatialImportJobPayload,
): Promise<SpatialImportJobResult> {
    const jobRunId = crypto.randomUUID();
    return runJob('spatial-import', async () => {
        const ctx = await buildJobContext(payload);
        if (!ctx.permissions.canWrite) {
            throw new Error(
                `spatial-import: user ${payload.initiatedByUserId} lacks write permission on tenant ${payload.tenantId}`,
            );
        }

        // 1 — stream the staged bytes back from storage.
        const storage = getStorageProvider();
        const buffer = await streamToBuffer(storage.readStream(payload.stagingPathKey));

        // 2 — parse OFF the request thread, time-bounded.
        const parsed = await parseWithBudget({
            filename: payload.filename,
            buffer,
            mimeType: payload.mimeType,
        });

        // 3 — complexity caps (pure, pre-persist): parcel count, per-parcel
        //     vertices, total vertices. Throws SpatialLimitError(422).
        assertParcelComplexity(parsed.parcels);

        // 4 — validate topology + persist atomically inside the tenant ctx.
        const { parcelCount } = await runInTenantContext(ctx, async (db) => {
            const location = await db.location.findFirst({
                where: { id: payload.locationId, tenantId: ctx.tenantId, deletedAt: null },
                select: { id: true, name: true },
            });
            if (!location) {
                throw new Error(
                    `spatial-import: location ${payload.locationId} not found for tenant ${ctx.tenantId}`,
                );
            }

            // 4a — topology check (ST_IsValid) over every parcel in ONE
            //      query. Reject the WHOLE import if any is invalid: a
            //      self-intersecting polygon would persist with a
            //      meaningless areaHa. A statement-level throw (PostGIS
            //      refused to even parse the GeoJSON) is also fail-closed.
            let invalidNames: string[];
            try {
                invalidNames = await ParcelRepository.findInvalidGeometryNames(db, parsed.parcels);
            } catch (err) {
                logger.warn('spatial-import.geometry_parse_rejected', {
                    component: 'spatial-import',
                    tenantId: ctx.tenantId,
                    locationId: payload.locationId,
                    error: err instanceof Error ? err.message : String(err),
                });
                throw new SpatialLimitError(
                    'Import contains malformed geometry that PostGIS refused to parse.',
                    422,
                );
            }
            if (invalidNames.length > 0) {
                const preview = invalidNames.slice(0, 5).join(', ');
                throw new SpatialLimitError(
                    `Import contains ${invalidNames.length} invalid (self-intersecting) parcel(s): ` +
                        `${preview}${invalidNames.length > 5 ? '…' : ''}. Fix the geometry and re-upload.`,
                    422,
                );
            }

            // 4b — replace the location's parcels + stamp the file/format/bounds.
            const count = await ParcelRepository.replaceForLocation(
                db,
                ctx,
                payload.locationId,
                parsed.parcels,
            );
            await db.location.update({
                where: { id: payload.locationId },
                data: {
                    spatialFileId: payload.stagingFileRecordId,
                    spatialFormat: parsed.format,
                    boundsJson: parsed.bounds
                        ? (parsed.bounds as unknown as Prisma.InputJsonValue)
                        : Prisma.JsonNull,
                },
            });

            await logEvent(db, ctx, {
                action: 'LOCATION_SPATIAL_IMPORTED',
                entityType: 'Location',
                entityId: payload.locationId,
                details: `Imported ${count} parcels from ${payload.filename}`,
                detailsJson: {
                    category: 'entity_lifecycle',
                    entityName: 'Location',
                    operation: 'updated',
                    after: { spatialFormat: parsed.format, parcelCount: count },
                    summary: `Imported ${count} parcels from ${payload.filename}`,
                },
            });

            return { parcelCount: count };
        });

        logger.info('spatial-import.completed', {
            component: 'spatial-import',
            tenantId: ctx.tenantId,
            locationId: payload.locationId,
            jobRunId,
            format: parsed.format,
            parcelCount,
        });

        return {
            tenantId: ctx.tenantId,
            locationId: payload.locationId,
            fileRecordId: payload.stagingFileRecordId,
            format: parsed.format,
            parcelCount,
            bounds: parsed.bounds,
            skipped: parsed.skipped,
            jobRunId,
        };
    }, { tenantId: payload.tenantId });
}
