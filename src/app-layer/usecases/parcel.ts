import { Prisma } from '@prisma/client';
import { RequestContext } from '../types';
import { assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { badRequest, notFound } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import type { PrismaTx } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { ParcelRepository } from '../repositories/ParcelRepository';
import type { Polygon, MultiPolygon, LineString } from 'geojson';

/**
 * In-map parcel authoring — the create / edit / delete write paths behind
 * the terra-draw drawing + vertex-editing UI on the Location map. The
 * spatial-import path (replaceForLocation) stays the bulk channel; these
 * are the single-parcel hand-drawn operations.
 *
 * Geometry I/O still goes exclusively through the geo helpers (the
 * ParcelRepository methods); areaHa is re-derived server-side from the
 * geometry (never trusted from the client), and the Location's cached
 * bounding box is recomputed after every shape change so the map re-fits.
 */

export interface CreateParcelInput {
    name: string;
    cropType?: string | null;
    geometry: Polygon | MultiPolygon;
}

export interface UpdateParcelInput {
    name?: string;
    cropType?: string | null;
    geometry?: Polygon | MultiPolygon;
}

/** Re-derive + persist the location's bounding box from its parcels. */
async function refreshLocationBounds(db: PrismaTx, ctx: RequestContext, locationId: string): Promise<void> {
    const bounds = await ParcelRepository.boundsForLocation(db, ctx, locationId);
    await db.location.update({
        where: { id: locationId },
        data: {
            boundsJson: bounds ? (bounds as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
    });
}

export async function createParcel(ctx: RequestContext, locationId: string, input: CreateParcelInput) {
    assertCanWrite(ctx);
    const name = sanitizePlainText((input.name ?? '').trim());
    if (!name) throw badRequest('Parcel name is required.');

    return runInTenantContext(ctx, async (db) => {
        const location = await db.location.findFirst({
            where: { id: locationId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!location) throw notFound('Location not found');

        if (!(await ParcelRepository.isValidGeometry(db, input.geometry))) {
            throw badRequest('Parcel shape is invalid (edges cross). Redraw it without self-intersections.');
        }

        const created = await ParcelRepository.createOne(db, ctx, locationId, {
            name,
            cropType: input.cropType ? sanitizePlainText(input.cropType.trim()) : null,
            geometry: input.geometry,
        });
        await refreshLocationBounds(db, ctx, locationId);

        await logEvent(db, ctx, {
            action: 'PARCEL_CREATED',
            entityType: 'Parcel',
            entityId: created.id,
            details: `Drew parcel ${name} (${created.areaHa ?? '?'} ha)`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Parcel',
                operation: 'created',
                after: { locationId, name, areaHa: created.areaHa },
                summary: `Drew parcel ${name}`,
            },
        });
        return created;
    });
}

export async function updateParcel(ctx: RequestContext, parcelId: string, input: UpdateParcelInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const parcel = await ParcelRepository.getOne(db, ctx, parcelId);
        if (!parcel) throw notFound('Parcel not found');

        if (input.geometry && !(await ParcelRepository.isValidGeometry(db, input.geometry))) {
            throw badRequest('Parcel shape is invalid (edges cross). Redraw it without self-intersections.');
        }

        const res = await ParcelRepository.updateOne(db, ctx, parcelId, {
            name: input.name !== undefined ? sanitizePlainText(input.name.trim()) : undefined,
            cropType:
                input.cropType !== undefined
                    ? input.cropType
                        ? sanitizePlainText(input.cropType.trim())
                        : null
                    : undefined,
            geometry: input.geometry,
        });
        if (input.geometry) await refreshLocationBounds(db, ctx, parcel.locationId);

        await logEvent(db, ctx, {
            action: 'PARCEL_UPDATED',
            entityType: 'Parcel',
            entityId: parcelId,
            details: `Edited parcel ${parcel.name}${input.geometry ? ' (reshaped)' : ''}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Parcel',
                operation: 'updated',
                after: { reshaped: Boolean(input.geometry), areaHa: res.areaHa },
                summary: `Edited parcel ${parcel.name}`,
            },
        });
        return res;
    });
}

export async function deleteParcel(ctx: RequestContext, parcelId: string) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const parcel = await ParcelRepository.getOne(db, ctx, parcelId);
        if (!parcel) throw notFound('Parcel not found');

        await ParcelRepository.softDeleteOne(db, ctx, parcelId);
        await refreshLocationBounds(db, ctx, parcel.locationId);

        await logEvent(db, ctx, {
            action: 'PARCEL_DELETED',
            entityType: 'Parcel',
            entityId: parcelId,
            details: `Deleted parcel ${parcel.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Parcel',
                operation: 'deleted',
                before: { name: parcel.name },
                summary: `Deleted parcel ${parcel.name}`,
            },
        });
        return { success: true };
    });
}

/**
 * Merge ≥2 parcels of a location into ONE new parcel (their geometric
 * union). The originals are soft-deleted; the union becomes a fresh parcel
 * named `name`. All geometry I/O is server-side + tenant/location-scoped
 * (a caller can never union across a tenant or field); areaHa is
 * re-derived from the union.
 */
export async function mergeParcels(
    ctx: RequestContext,
    locationId: string,
    parcelIds: string[],
    name: string,
) {
    assertCanWrite(ctx);
    const cleanName = sanitizePlainText((name ?? '').trim());
    if (!cleanName) throw badRequest('Merged parcel name is required.');
    // De-dupe defensively so a repeated id can't undercount the validation.
    const ids = [...new Set(parcelIds)];
    if (ids.length < 2) throw badRequest('Select at least two parcels to merge.');

    return runInTenantContext(ctx, async (db) => {
        const location = await db.location.findFirst({
            where: { id: locationId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!location) throw notFound('Location not found');

        const valid = await ParcelRepository.validIdsForLocation(db, ctx, locationId, ids);
        if (valid.size !== ids.length) {
            throw badRequest('One or more parcels were not found in this field.');
        }

        const merged = await ParcelRepository.unionForLocation(db, ctx, locationId, ids);
        if (!merged) throw badRequest('Could not merge the selected parcels.');
        if (!(await ParcelRepository.isValidGeometry(db, merged))) {
            throw badRequest('The merged shape is invalid. Check the selected parcels do not overlap badly.');
        }

        const created = await ParcelRepository.createOne(db, ctx, locationId, {
            name: cleanName,
            geometry: merged,
        });
        for (const id of ids) {
            await ParcelRepository.softDeleteOne(db, ctx, id);
        }
        await refreshLocationBounds(db, ctx, locationId);

        await logEvent(db, ctx, {
            action: 'PARCEL_MERGED',
            entityType: 'Parcel',
            entityId: created.id,
            details: `Merged ${ids.length} parcels into ${cleanName} (${created.areaHa ?? '?'} ha)`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Parcel',
                operation: 'created',
                after: { locationId, name: cleanName, areaHa: created.areaHa, mergedFrom: ids.length },
                summary: `Merged ${ids.length} parcels into ${cleanName}`,
            },
        });
        return created;
    });
}

/**
 * Split ONE parcel along a drawn line into the pieces the blade cuts it
 * into (≥2). The original is soft-deleted; each piece becomes a new parcel
 * named `${original} (n)`. Rejects a blade that doesn't fully divide the
 * parcel. Geometry I/O is server-side + tenant-scoped.
 */
export async function splitParcel(ctx: RequestContext, parcelId: string, line: LineString) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const parcel = await ParcelRepository.getOne(db, ctx, parcelId);
        if (!parcel) throw notFound('Parcel not found');

        const pieces = await ParcelRepository.splitOne(db, ctx, parcelId, line);
        if (pieces.length < 2) {
            throw badRequest('The cut line must fully cross the parcel into two or more pieces.');
        }

        const created: Array<{ id: string; areaHa: number | null }> = [];
        let n = 0;
        for (const piece of pieces) {
            n += 1;
            created.push(
                await ParcelRepository.createOne(db, ctx, parcel.locationId, {
                    name: `${parcel.name} (${n})`,
                    geometry: piece,
                }),
            );
        }
        await ParcelRepository.softDeleteOne(db, ctx, parcelId);
        await refreshLocationBounds(db, ctx, parcel.locationId);

        await logEvent(db, ctx, {
            action: 'PARCEL_SPLIT',
            entityType: 'Parcel',
            entityId: parcelId,
            details: `Split parcel ${parcel.name} into ${created.length} pieces`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Parcel',
                operation: 'updated',
                before: { name: parcel.name },
                after: { pieces: created.length },
                summary: `Split parcel ${parcel.name} into ${created.length} pieces`,
            },
        });
        return { pieces: created };
    });
}
