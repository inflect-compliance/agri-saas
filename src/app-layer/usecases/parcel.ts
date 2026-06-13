import { Prisma } from '@prisma/client';
import { RequestContext } from '../types';
import { assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { badRequest, notFound } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import type { PrismaTx } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { ParcelRepository } from '../repositories/ParcelRepository';
import type { Polygon, MultiPolygon } from 'geojson';

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
