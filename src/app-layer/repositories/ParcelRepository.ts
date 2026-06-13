import { Prisma } from '@prisma/client';
import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';
import {
    geometrySql,
    areaHectaresSql,
    asGeoJsonSql,
    col,
    parseGeometry,
    locationParcelBoundsSql,
    isValidGeometrySql,
} from '@/lib/db/geo';
import type { ParsedParcel } from '@/lib/spatial/parse';
import type { Geometry, Polygon, MultiPolygon } from 'geojson';

/** A parcel returned to the client — geometry serialized to GeoJSON. */
export interface ParcelGeo {
    id: string;
    name: string;
    cropType: string | null;
    areaHa: number | null;
    geometry: Geometry | null;
    properties: unknown;
}

/**
 * Parcel repository — the ONLY consumer of the geo helpers. All
 * geometry I/O is raw SQL (the `geometry` column is a Prisma
 * `Unsupported(...)`), built exclusively from `src/lib/db/geo.ts`
 * fragments and run via `$executeRaw` / `$queryRaw` inside a tenant
 * transaction (RLS-scoped). No `ST_*` text appears here — only the
 * typed fragments — so the geo-raw-sql-containment guardrail holds.
 */
export class ParcelRepository {
    /**
     * Replace all parcels for a Location with the freshly-parsed set.
     * Hard-deletes the existing parcels (re-import semantics) then
     * inserts each one, writing geometry via ST_GeomFromGeoJSON and
     * areaHa via ST_Area (geography cast → hectares). Returns the count.
     */
    static async replaceForLocation(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        parcels: ParsedParcel[],
    ): Promise<number> {
        await db.parcel.deleteMany({ where: { locationId, tenantId: ctx.tenantId } });

        for (const p of parcels) {
            // Create the row through Prisma so id/defaults are minted,
            // omitting the Unsupported geometry column…
            const row = await db.parcel.create({
                data: {
                    tenantId: ctx.tenantId,
                    locationId,
                    name: p.name,
                    propertiesJson: (p.properties ?? {}) as Prisma.InputJsonValue,
                },
                select: { id: true },
            });
            // …then stamp geometry + denormalized areaHa via the geo
            // fragments. areaHa is computed from the same geometry
            // expression so it lands in one statement.
            await db.$executeRaw(
                Prisma.sql`UPDATE "Parcel"
                    SET "geometry" = ${geometrySql(p.geometry)},
                        "areaHa" = ${areaHectaresSql(geometrySql(p.geometry))}
                    WHERE "id" = ${row.id} AND "tenantId" = ${ctx.tenantId}`,
            );
        }

        return parcels.length;
    }

    /** List a location's parcels with geometry serialized to GeoJSON. */
    static async listForLocation(db: PrismaTx, ctx: RequestContext, locationId: string): Promise<ParcelGeo[]> {
        const rows = await db.$queryRaw<Array<{
            id: string;
            name: string;
            cropType: string | null;
            areaHa: string | null;
            geojson: string | null;
            propertiesJson: unknown;
        }>>(
            Prisma.sql`SELECT "id", "name", "cropType", "areaHa"::text AS "areaHa",
                    ${asGeoJsonSql(col('geometry'))} AS "geojson", "propertiesJson"
                FROM "Parcel"
                WHERE "locationId" = ${locationId}
                  AND "tenantId" = ${ctx.tenantId}
                  AND "deletedAt" IS NULL
                ORDER BY "name" ASC`,
        );

        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            cropType: r.cropType,
            areaHa: r.areaHa !== null ? Number(r.areaHa) : null,
            geometry: parseGeometry(r.geojson),
            properties: r.propertiesJson ?? null,
        }));
    }

    /** Count a location's (non-deleted) parcels. */
    static async countForLocation(db: PrismaTx, ctx: RequestContext, locationId: string): Promise<number> {
        return db.parcel.count({ where: { locationId, tenantId: ctx.tenantId, deletedAt: null } });
    }

    /**
     * Create ONE parcel from a hand-drawn polygon. Mirrors the inner
     * loop of `replaceForLocation`: mint the row via Prisma (omitting the
     * Unsupported geometry column), then stamp geometry + denormalized
     * areaHa via the geo fragments. Returns the id + computed areaHa.
     */
    static async createOne(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        input: { name: string; cropType?: string | null; geometry: Polygon | MultiPolygon },
    ): Promise<{ id: string; areaHa: number | null }> {
        const row = await db.parcel.create({
            data: {
                tenantId: ctx.tenantId,
                locationId,
                name: input.name,
                cropType: input.cropType ?? null,
            },
            select: { id: true },
        });
        await db.$executeRaw(
            Prisma.sql`UPDATE "Parcel"
                SET "geometry" = ${geometrySql(input.geometry)},
                    "areaHa" = ${areaHectaresSql(geometrySql(input.geometry))}
                WHERE "id" = ${row.id} AND "tenantId" = ${ctx.tenantId}`,
        );
        return { id: row.id, areaHa: await ParcelRepository.areaHaFor(db, ctx, row.id) };
    }

    /**
     * Update a single parcel's scalars and/or its geometry (re-derives
     * areaHa from the new geometry). Geometry edits come from the in-map
     * vertex editor. Tenant-scoped; returns the (possibly new) areaHa.
     */
    static async updateOne(
        db: PrismaTx,
        ctx: RequestContext,
        parcelId: string,
        input: { name?: string; cropType?: string | null; geometry?: Polygon | MultiPolygon },
    ): Promise<{ areaHa: number | null }> {
        const scalar: Prisma.ParcelUpdateInput = {};
        if (input.name !== undefined) scalar.name = input.name;
        if (input.cropType !== undefined) scalar.cropType = input.cropType;
        if (Object.keys(scalar).length > 0) {
            await db.parcel.update({ where: { id: parcelId }, data: scalar });
        }
        if (input.geometry) {
            await db.$executeRaw(
                Prisma.sql`UPDATE "Parcel"
                    SET "geometry" = ${geometrySql(input.geometry)},
                        "areaHa" = ${areaHectaresSql(geometrySql(input.geometry))}
                    WHERE "id" = ${parcelId} AND "tenantId" = ${ctx.tenantId}`,
            );
        }
        return { areaHa: await ParcelRepository.areaHaFor(db, ctx, parcelId) };
    }

    /** Soft-delete a parcel (history-preserving; mirrors the entity trio). */
    static async softDeleteOne(db: PrismaTx, ctx: RequestContext, parcelId: string): Promise<void> {
        await db.parcel.update({
            where: { id: parcelId },
            data: { deletedAt: new Date(), deletedByUserId: ctx.userId ?? null },
        });
    }

    /**
     * Topology check for a hand-drawn polygon (rejects self-intersections
     * before they become a meaningless areaHa). Runs `ST_IsValid` via the
     * geo helper so the `ST_*` stays contained in geo.ts.
     */
    static async isValidGeometry(db: PrismaTx, geometry: Polygon | MultiPolygon): Promise<boolean> {
        const rows = await db.$queryRaw<Array<{ valid: boolean }>>(
            Prisma.sql`SELECT ${isValidGeometrySql(geometry)} AS "valid"`,
        );
        return rows[0]?.valid === true;
    }

    /** Fetch one parcel's identity (ownership/location lookup). Tenant-scoped. */
    static async getOne(db: PrismaTx, ctx: RequestContext, parcelId: string) {
        return db.parcel.findFirst({
            where: { id: parcelId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true, locationId: true },
        });
    }

    /** Read back the denormalized areaHa for a parcel (post-write). */
    private static async areaHaFor(db: PrismaTx, ctx: RequestContext, parcelId: string): Promise<number | null> {
        const rows = await db.parcel.findMany({
            where: { id: parcelId, tenantId: ctx.tenantId },
            select: { areaHa: true },
            take: 1,
        });
        const a = rows[0]?.areaHa ?? null;
        return a !== null ? Number(a) : null;
    }

    /**
     * Recompute a location's WGS84 bounding box from its current parcels
     * (after a draw / edit / delete). Returns `[w, s, e, n]` or null when
     * the location has no parcels with geometry. The `ST_*` lives in
     * geo.ts (locationParcelBoundsSql).
     */
    static async boundsForLocation(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
    ): Promise<[number, number, number, number] | null> {
        const rows = await db.$queryRaw<Array<{ xmin: number; ymin: number; xmax: number; ymax: number }>>(
            locationParcelBoundsSql(locationId, ctx.tenantId),
        );
        if (!rows.length || rows[0].xmin === null) return null;
        const { xmin, ymin, xmax, ymax } = rows[0];
        return [Number(xmin), Number(ymin), Number(xmax), Number(ymax)];
    }

    /**
     * Of the supplied ids, return those that are real, non-deleted
     * parcels of this location (used to validate a field-operation's
     * parcel selection). Tenant-scoped.
     */
    static async validIdsForLocation(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        ids: string[],
    ): Promise<Set<string>> {
        if (ids.length === 0) return new Set();
        const rows = await db.parcel.findMany({
            where: { id: { in: ids }, locationId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
    }
}
