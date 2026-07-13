import { Prisma } from '@prisma/client';
import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';
import {
    repairedGeometrySql,
    reprojectedRepairedGeometrySql,
    probeCandidateSridSql,
    areaHectaresNonNullSql,
    asGeoJsonSql,
    simplifiedGeoJsonSql,
    mvtTileSql,
    col,
    parseGeometry,
    locationParcelBoundsSql,
    isValidGeometrySql,
    invalidGeometryIndicesSql,
    unionParcelsGeoJsonSql,
    splitParcelGeoJsonSql,
    centroidLonLatSql,
} from '@/lib/db/geo';
import type { ParsedParcel } from '@/lib/spatial/parse';
import { SUPPORTED_SOURCE_SRIDS, type SupportedSourceSrid } from '@/lib/spatial/parse';
import type { Geometry, Polygon, MultiPolygon, LineString } from 'geojson';
import type { SoilProfile } from '@/lib/soil/types';

/**
 * Part A (PR2) — Bulgaria's WGS84 bounding envelope. The candidate-SRID probe
 * accepts the source CRS whose TRANSFORMED bounds land fully inside this box.
 * Deliberately generous (a few km of slack past the national border) so a
 * legitimate border parcel is never rejected, but far tighter than the globe:
 * a wrong CRS (7801 metres read as 32635, or vice-versa) transforms to a point
 * hundreds of km away — well outside this box — so exactly one candidate matches.
 */
export const BULGARIA_WGS84_ENVELOPE = {
    lonMin: 22.0,
    lonMax: 29.0,
    latMin: 41.0,
    latMax: 44.5,
} as const;

/** A parcel returned to the client — geometry serialized to GeoJSON. */
export interface ParcelGeo {
    id: string;
    name: string;
    cropType: string | null;
    areaHa: number | null;
    geometry: Geometry | null;
    properties: unknown;
    /** Cadastral identifier `EKATTE.masiv.parcel` (КАИС); null when not parsed. */
    cadastralId: string | null;
    /** 5-digit EKATTE settlement prefix of `cadastralId`; null when absent. */
    ekatte: string | null;
    /** Human soil label (modelled estimate); null until the fetch job runs. */
    soilType: string | null;
    /** Structured modelled soil profile; null while "soil pending". */
    soilJson: SoilProfile | null;
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
     * Add the freshly-parsed parcels to a Location (ADDITIVE import — the
     * location's existing parcels are KEPT; a re-import appends). Inserts each
     * one, writing geometry via ST_GeomFromGeoJSON and areaHa via ST_Area
     * (geography cast → hectares). Optionally stamps a default `cropType` on
     * every parcel (#7). Returns the created parcel ids. Per-parcel deletion is
     * a separate, explicit action (see the `deleteParcel` usecase).
     */
    static async addParcelsForLocation(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        parcels: ParsedParcel[],
        cropType?: string | null,
        /**
         * Source SRID of `parcels[].geometry` when it is NOT WGS84 (Bulgarian
         * cadastre 7801 / 32635). When set, geometry + areaHa are computed
         * from the REPROJECTING fragment (`ST_Transform → 4326` before repair),
         * so `areaHa` derives from the SAME reprojected expression as the
         * stored geometry. Omit / undefined ⇒ geometry is already 4326.
         */
        sourceSrid?: number,
    ): Promise<string[]> {
        // A blank / whitespace-only default means "mixed — set later": leave
        // cropType null so it isn't stamped on every imported parcel (#7).
        const importCrop = cropType && cropType.trim().length > 0 ? cropType.trim() : null;

        const createdIds: string[] = [];
        for (const p of parcels) {
            // Create the row through Prisma so id/defaults are minted,
            // omitting the Unsupported geometry column…
            const row = await db.parcel.create({
                data: {
                    tenantId: ctx.tenantId,
                    locationId,
                    name: p.name,
                    cropType: importCrop,
                    cadastralId: p.cadastralId ?? null,
                    ekatte: p.ekatte ?? null,
                    propertiesJson: (p.properties ?? {}) as Prisma.InputJsonValue,
                },
                select: { id: true },
            });
            // …then stamp geometry + denormalized areaHa via the geo
            // fragments. areaHa is computed from the same geometry
            // expression so it lands in one statement — including, for a
            // cadastre import, the SAME reprojection (invariant: areaHa and
            // geometry share one expression).
            const geomSql = sourceSrid
                ? reprojectedRepairedGeometrySql(p.geometry, sourceSrid)
                : repairedGeometrySql(p.geometry);
            await db.$executeRaw(
                Prisma.sql`UPDATE "Parcel"
                    SET "geometry" = ${geomSql},
                        "areaHa" = ${areaHectaresNonNullSql(geomSql)}
                    WHERE "id" = ${row.id} AND "tenantId" = ${ctx.tenantId}`,
            );
            createdIds.push(row.id);
        }

        return createdIds;
    }

    /**
     * List a location's parcels with geometry serialized to GeoJSON.
     *
     * `simplifyTolerance` (degrees) opts into `ST_Simplify` on the export
     * read path — a 50-field location ships a fraction of the vertices for
     * display. Omit it (the default) for the exact geometry the sketch /
     * edit map and the area computation need.
     */
    static async listForLocation(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        opts: { simplifyTolerance?: number } = {},
    ): Promise<ParcelGeo[]> {
        const geojsonSql = opts.simplifyTolerance != null
            ? simplifiedGeoJsonSql(col('geometry'), opts.simplifyTolerance)
            : asGeoJsonSql(col('geometry'));
        const rows = await db.$queryRaw<Array<{
            id: string;
            name: string;
            cropType: string | null;
            areaHa: string | null;
            geojson: string | null;
            propertiesJson: unknown;
            soilType: string | null;
            soilJson: unknown;
            cadastralId: string | null;
            ekatte: string | null;
        }>>(
            Prisma.sql`SELECT "id", "name", "cropType", "areaHa"::text AS "areaHa",
                    ${geojsonSql} AS "geojson", "propertiesJson", "soilType", "soilJson",
                    "cadastralId", "ekatte"
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
            soilType: r.soilType,
            soilJson: (r.soilJson ?? null) as SoilProfile | null,
            cadastralId: r.cadastralId,
            ekatte: r.ekatte,
        }));
    }

    /**
     * Render a location's parcels as a Mapbox Vector Tile (the binary
     * protobuf the map's vector source consumes) for the z/x/y tile.
     * Tenant- + location-scoped via the geo fragment; returns an empty
     * buffer when no parcel touches the tile (the route answers 204).
     */
    static async mvtForTile(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        z: number,
        x: number,
        y: number,
    ): Promise<Buffer> {
        const rows = await db.$queryRaw<Array<{ mvt: Uint8Array | null }>>(
            mvtTileSql(z, x, y, locationId, ctx.tenantId),
        );
        const mvt = rows[0]?.mvt;
        // The pg adapter returns `bytea` as a Uint8Array, not a Node Buffer
        // — normalise (Buffer.from copies the view) so the return type is
        // exact and the route streams a real Buffer.
        return mvt ? Buffer.from(mvt) : Buffer.alloc(0);
    }

    /** Count a location's (non-deleted) parcels. */
    static async countForLocation(db: PrismaTx, ctx: RequestContext, locationId: string): Promise<number> {
        return db.parcel.count({ where: { locationId, tenantId: ctx.tenantId, deletedAt: null } });
    }

    /**
     * Create ONE parcel from a hand-drawn polygon. Mirrors the inner
     * loop of `addParcelsForLocation`: mint the row via Prisma (omitting the
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
                SET "geometry" = ${repairedGeometrySql(input.geometry)},
                    "areaHa" = ${areaHectaresNonNullSql(repairedGeometrySql(input.geometry))}
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
                    SET "geometry" = ${repairedGeometrySql(input.geometry)},
                        "areaHa" = ${areaHectaresNonNullSql(repairedGeometrySql(input.geometry))}
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

    /**
     * Of the freshly-parsed parcels, return the NAMES of those whose
     * geometry is NOT topologically valid (self-intersecting rings,
     * malformed polygons). Runs ONE batched `ST_IsValid` query (no
     * N+1) over every parcel's geometry. The spatial-import job rejects
     * the whole import when this is non-empty, so a pathological polygon
     * never reaches `addParcelsForLocation` — where `ST_GeomFromGeoJSON`
     * would happily accept it and then yield a meaningless `ST_Area`.
     *
     * No tenant/location scope: the geometries here are the in-memory
     * parsed payload, not persisted rows, so there is nothing to leak —
     * they're validated BEFORE the first write.
     */
    static async findInvalidGeometryNames(
        db: PrismaTx,
        parcels: ReadonlyArray<ParsedParcel>,
    ): Promise<string[]> {
        if (parcels.length === 0) return [];
        const rows = await db.$queryRaw<Array<{ idx: number }>>(
            invalidGeometryIndicesSql(parcels.map((p) => p.geometry)),
        );
        return rows.map((r) => {
            const i = Number(r.idx);
            return parcels[i]?.name ?? `Parcel ${i + 1}`;
        });
    }

    /**
     * Part A (PR2) — PROBE the source CRS of a prj-less projected-metre import.
     * When the parser flags `sourceCrs: 'projected-candidate'` (Bulgarian metre
     * bounds, but no `.prj` to resolve 7801 vs 32635), transform a bounded
     * SAMPLE of the parcels from each candidate SRID to WGS84 in ONE round-trip
     * and pick the candidate whose transformed bounds land INSIDE Bulgaria's
     * envelope. Returns the winning SRID, or `null` when zero or MORE THAN ONE
     * candidate matches (ambiguous — the caller rejects with an actionable
     * error). Disambiguation is by REPROJECTED position only, never raw metre
     * magnitude (7801 and 32635 overlap by magnitude over Bulgaria).
     *
     * No tenant/location scope: the geometries are the in-memory parsed
     * payload, validated BEFORE the first write — nothing to leak.
     */
    static async probeSourceSrid(
        db: PrismaTx,
        parcels: ReadonlyArray<ParsedParcel>,
        candidates: readonly SupportedSourceSrid[] = SUPPORTED_SOURCE_SRIDS,
    ): Promise<SupportedSourceSrid | null> {
        if (parcels.length === 0 || candidates.length === 0) return null;
        // Bound the probe cost: a handful of parcels pins the transformed bbox
        // just as well as thousands (an import is one contiguous cadastral area).
        const sample = parcels.slice(0, 16).map((p) => p.geometry);
        const rows = await db.$queryRaw<Array<{
            srid: number;
            xmin: number | null;
            ymin: number | null;
            xmax: number | null;
            ymax: number | null;
        }>>(probeCandidateSridSql(sample, candidates));

        const env = BULGARIA_WGS84_ENVELOPE;
        const matches = rows.filter((r) => {
            if (r.xmin === null || r.ymin === null || r.xmax === null || r.ymax === null) return false;
            const w = Number(r.xmin), s = Number(r.ymin), e = Number(r.xmax), n = Number(r.ymax);
            return (
                w >= env.lonMin && e <= env.lonMax &&
                s >= env.latMin && n <= env.latMax
            );
        });
        if (matches.length !== 1) return null;
        const srid = Number(matches[0].srid) as SupportedSourceSrid;
        return SUPPORTED_SOURCE_SRIDS.includes(srid) ? srid : null;
    }

    /**
     * Geometric UNION of the given parcels (a MERGE), as a single
     * MultiPolygon — or null when no matching parcel has geometry. The
     * query is tenant- AND location-scoped (geo.ts), so it can never union
     * across a tenant or field. The caller validates the ids belong to the
     * location first, persists the union via `createOne`, then soft-deletes
     * the originals.
     */
    static async unionForLocation(
        db: PrismaTx,
        ctx: RequestContext,
        locationId: string,
        parcelIds: string[],
    ): Promise<MultiPolygon | null> {
        const rows = await db.$queryRaw<Array<{ geojson: string | null }>>(
            unionParcelsGeoJsonSql(locationId, ctx.tenantId, parcelIds),
        );
        const g = parseGeometry(rows[0]?.geojson ?? null);
        if (g && (g.type === 'MultiPolygon' || g.type === 'Polygon')) {
            return g as MultiPolygon;
        }
        return null;
    }

    /**
     * SPLIT a parcel along a LineString blade into its polygonal pieces.
     * Returns one geometry per piece (empty/single when the blade did not
     * divide the parcel — the caller rejects `< 2`). Tenant-scoped on the
     * source parcel via geo.ts.
     */
    static async splitOne(
        db: PrismaTx,
        ctx: RequestContext,
        parcelId: string,
        line: LineString,
    ): Promise<Array<Polygon | MultiPolygon>> {
        const rows = await db.$queryRaw<Array<{ geojson: string | null }>>(
            splitParcelGeoJsonSql(parcelId, ctx.tenantId, line),
        );
        const pieces: Array<Polygon | MultiPolygon> = [];
        for (const r of rows) {
            const g = parseGeometry(r.geojson);
            if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
                pieces.push(g);
            }
        }
        return pieces;
    }

    /** Fetch one parcel's identity (ownership/location lookup). Tenant-scoped. */
    static async getOne(db: PrismaTx, ctx: RequestContext, parcelId: string) {
        return db.parcel.findFirst({
            where: { id: parcelId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, name: true, locationId: true },
        });
    }

    /**
     * WGS84 centroid (lon/lat) of a parcel's geometry, for the soil-fetch
     * lookup. Tenant-scoped; the `ST_Centroid` lives in geo.ts. Returns
     * null when the parcel is missing or has no geometry (caller treats
     * that as "no centroid, skip" — never throws / blocks).
     */
    static async centroidLonLat(
        db: PrismaTx,
        ctx: RequestContext,
        parcelId: string,
    ): Promise<{ lon: number; lat: number } | null> {
        const rows = await db.$queryRaw<Array<{ lon: number | null; lat: number | null }>>(
            Prisma.sql`SELECT ${centroidLonLatSql(col('geometry'))} FROM "Parcel"
                WHERE "id" = ${parcelId} AND "tenantId" = ${ctx.tenantId}
                  AND "deletedAt" IS NULL AND ${col('geometry')} IS NOT NULL`,
        );
        const r = rows[0];
        if (!r || r.lon === null || r.lat === null) return null;
        return { lon: Number(r.lon), lat: Number(r.lat) };
    }

    /**
     * A single parcel's geometry as GeoJSON (#13) — the exact polygon fed to
     * the Earth-Engine per-parcel reduce. Tenant-scoped; returns null when the
     * parcel is missing or has no geometry (caller degrades to "no reading").
     */
    static async geometryForParcel(
        db: PrismaTx,
        ctx: RequestContext,
        parcelId: string,
    ): Promise<Geometry | null> {
        const rows = await db.$queryRaw<Array<{ geojson: string | null }>>(
            Prisma.sql`SELECT ${asGeoJsonSql(col('geometry'))} AS "geojson" FROM "Parcel"
                WHERE "id" = ${parcelId} AND "tenantId" = ${ctx.tenantId}
                  AND "deletedAt" IS NULL AND ${col('geometry')} IS NOT NULL`,
        );
        const raw = rows[0]?.geojson ?? null;
        return raw ? (parseGeometry(raw) as Geometry) : null;
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
