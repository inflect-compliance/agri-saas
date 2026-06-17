import { RequestContext } from '../types';
import { LocationRepository, LocationFilters, LocationListParams } from '../repositories/LocationRepository';
import { ParcelRepository } from '../repositories/ParcelRepository';
import { assertCanRead, assertCanWrite, assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { notFound } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import { assertWithinLimit } from '@/lib/billing/entitlements';

export interface CreateLocationInput {
    name: string;
    description?: string | null;
    status?: 'ACTIVE' | 'ARCHIVED';
    ownerUserId?: string | null;
}

export interface UpdateLocationInput {
    name?: string;
    description?: string | null;
    status?: 'ACTIVE' | 'ARCHIVED';
    ownerUserId?: string | null;
}

export async function listLocations(ctx: RequestContext, filters?: LocationFilters) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => LocationRepository.list(db, ctx, filters));
}

export async function listLocationsPaginated(ctx: RequestContext, params: LocationListParams) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => LocationRepository.listPaginated(db, ctx, params));
}

export async function getLocation(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const location = await LocationRepository.getById(db, ctx, id);
        if (!location) throw notFound('Location not found');
        return location;
    });
}

/** Location plus its parcels (geometry serialized to GeoJSON) — feeds the map. */
export async function getLocationWithParcels(ctx: RequestContext, id: string) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const location = await LocationRepository.getById(db, ctx, id);
        if (!location) throw notFound('Location not found');
        const parcels = await ParcelRepository.listForLocation(db, ctx, id);
        return { ...location, parcels };
    });
}

/**
 * Just the parcels for a location, as GeoJSON. `simplifyTolerance`
 * (degrees) opts into `ST_Simplify` on the export path for a lighter
 * payload on a many-field location; omit it for exact sketch/edit
 * geometry.
 */
export async function listLocationParcels(
    ctx: RequestContext,
    id: string,
    opts: { simplifyTolerance?: number } = {},
) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const location = await LocationRepository.getById(db, ctx, id);
        if (!location) throw notFound('Location not found');
        const parcels = await ParcelRepository.listForLocation(db, ctx, id, opts);
        return { locationId: id, bounds: location.boundsJson ?? null, parcels };
    });
}

/**
 * Render a location's parcels as a Mapbox Vector Tile (binary protobuf)
 * for the z/x/y tile — the map's vector source at zoom ≥ 6. Tenant- +
 * location-scoped in the repository; an empty buffer means no parcel
 * touches the tile.
 */
export async function getLocationParcelTile(
    ctx: RequestContext,
    locationId: string,
    z: number,
    x: number,
    y: number,
): Promise<Buffer> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, (db) => ParcelRepository.mvtForTile(db, ctx, locationId, z, x, y));
}

export async function createLocation(ctx: RequestContext, data: CreateLocationInput) {
    assertCanWrite(ctx);
    // Plan gate: a startup-farmer (FREE) tenant caps the number of farms/fields.
    await assertWithinLimit(ctx, 'location');
    return runInTenantContext(ctx, async (db) => {
        const location = await LocationRepository.create(db, ctx, {
            name: data.name,
            description: data.description ?? null,
            ...(data.status ? { status: data.status } : {}),
            ownerUserId: data.ownerUserId || null,
            createdByUserId: ctx.userId,
        });

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'Location',
            entityId: location.id,
            details: `Created location: ${location.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Location',
                operation: 'created',
                after: { name: location.name },
                summary: `Created location: ${location.name}`,
            },
        });

        return location;
    });
}

export async function updateLocation(ctx: RequestContext, id: string, data: UpdateLocationInput) {
    assertCanWrite(ctx);
    return runInTenantContext(ctx, async (db) => {
        const location = await LocationRepository.update(db, ctx, id, {
            name: data.name,
            description: data.description,
            status: data.status,
            ownerUserId:
                data.ownerUserId === undefined ? undefined : data.ownerUserId || null,
        });
        if (!location) throw notFound('Location not found');

        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'Location',
            entityId: id,
            details: 'Location updated',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Location',
                operation: 'updated',
                changedFields: Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined),
                summary: 'Location updated',
            },
        });

        return location;
    });
}

export async function deleteLocation(ctx: RequestContext, id: string) {
    assertCanAdmin(ctx);
    return runInTenantContext(ctx, async (db) => {
        const deleted = await LocationRepository.softDelete(db, ctx, id);
        if (!deleted) throw notFound('Location not found');

        await logEvent(db, ctx, {
            action: 'SOFT_DELETE',
            entityType: 'Location',
            entityId: id,
            details: 'Location soft-deleted',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Location',
                operation: 'deleted',
                summary: 'Location soft-deleted',
            },
        });

        return { success: true };
    });
}
