/**
 * Geo / PostGIS helpers — the ONLY place raw `ST_*` SQL is allowed.
 *
 * `Parcel.geometry` is a Prisma `Unsupported("geometry(MultiPolygon,
 * 4326)")` column: the Prisma client cannot read or write it through
 * the normal API, so all geometry I/O goes through the `Prisma.sql`
 * fragments built here and is run via `$executeRaw` / `$queryRaw` in
 * the parcel repository.
 *
 * A guardrail (geo-raw-sql-containment) asserts that `ST_` only appears
 * in this file, so the spatial surface stays auditable.
 */
import { Prisma } from '@prisma/client';
import type { Geometry, Polygon, MultiPolygon } from 'geojson';

/**
 * SQL fragment that converts a GeoJSON geometry (passed as a JSON
 * string parameter) into a PostGIS `geometry(MultiPolygon, 4326)`:
 * parse → coerce to MultiPolygon → stamp SRID 4326. Use inside an
 * INSERT/UPDATE, e.g. `Prisma.sql\`... SET "geometry" = ${geometrySql(g)}\``.
 */
export function geometrySql(geometry: Polygon | MultiPolygon): Prisma.Sql {
    const json = JSON.stringify(geometry);
    return Prisma.sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326))`;
}

/**
 * SQL fragment computing the area of a geometry column in hectares,
 * using the geography cast for an accurate on-the-ellipsoid area
 * (m²) divided by 10,000. Returns NULL-safe NUMERIC.
 */
export function areaHectaresSql(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`ROUND((ST_Area(${column}::geography) / 10000.0)::numeric, 4)`;
}

/** SQL fragment serializing a geometry column back to GeoJSON text. */
export function asGeoJsonSql(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`ST_AsGeoJSON(${column})`;
}

/** Bare column reference helper (keeps quoting in one place). */
export function col(name: string): Prisma.Sql {
    return Prisma.raw(`"${name}"`);
}

/**
 * SQL fragment evaluating to `true` when the GeoJSON geometry is
 * topologically valid (no self-intersections, properly-closed rings).
 * `ST_GeomFromGeoJSON` accepts self-intersecting polygons that then
 * produce a meaningless `ST_Area`, so hand-drawn parcels are validated
 * with this before they're persisted.
 */
export function isValidGeometrySql(geometry: Polygon | MultiPolygon): Prisma.Sql {
    return Prisma.sql`ST_IsValid(${geometrySql(geometry)})`;
}

/**
 * Full query computing the WGS84 bounding box of all non-deleted parcels
 * of a location, as four corners (xmin/ymin/xmax/ymax = west/south/east/
 * north). Returns no row (or NULL corners) when the location has no
 * parcels with geometry. Run via `$queryRaw`; the caller maps the row to
 * `[w, s, e, n]`. Lives here so the `ST_*` stays contained in geo.ts.
 */
export function locationParcelBoundsSql(locationId: string, tenantId: string): Prisma.Sql {
    return Prisma.sql`
        SELECT ST_XMin(ext) AS "xmin", ST_YMin(ext) AS "ymin",
               ST_XMax(ext) AS "xmax", ST_YMax(ext) AS "ymax"
        FROM (
            SELECT ST_Extent("geometry") AS ext
            FROM "Parcel"
            WHERE "locationId" = ${locationId}
              AND "tenantId" = ${tenantId}
              AND "deletedAt" IS NULL
        ) s
        WHERE ext IS NOT NULL`;
}

/** Parse a GeoJSON string returned by `ST_AsGeoJSON` back into a typed geometry. */
export function parseGeometry(geojson: string | null): Geometry | null {
    if (!geojson) return null;
    try {
        return JSON.parse(geojson) as Geometry;
    } catch {
        return null;
    }
}
