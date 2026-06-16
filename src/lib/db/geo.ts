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
import type { Geometry, Polygon, MultiPolygon, LineString } from 'geojson';

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
 * Full query: of the supplied GeoJSON geometries, return the 0-based
 * indices (column `idx`) of those that are NOT topologically valid —
 * self-intersecting rings, malformed polygons, etc. The geometries are
 * passed as an unnested `VALUES` list so a bulk parcel-import's validity
 * check is ONE round-trip, never an N+1 loop of per-parcel `ST_IsValid`.
 *
 * Mirrors `geometrySql`'s construction
 * (`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(...), 4326))`) so a geometry
 * that passes here is byte-identical to the one `replaceForLocation`
 * persists. Run via `$queryRaw`; the caller maps each `idx` back to its
 * parcel. Lives here so the `ST_*` stays contained in geo.ts.
 *
 * NOTE: `ST_GeomFromGeoJSON` *throws* (aborting the whole statement) on
 * structurally-malformed JSON rather than returning an invalid geometry.
 * The spatial parser only ever produces well-formed MultiPolygon
 * structures, so the realistic failure here is topological (caught by
 * `ST_IsValid`); the caller treats a thrown statement as "import
 * contains malformed geometry" and fails closed.
 */
export function invalidGeometryIndicesSql(
    geometries: ReadonlyArray<Polygon | MultiPolygon>,
): Prisma.Sql {
    const rows = geometries.map(
        (g, i) => Prisma.sql`(${i}::int, ${JSON.stringify(g)}::text)`,
    );
    return Prisma.sql`
        SELECT t."idx" AS "idx"
        FROM (VALUES ${Prisma.join(rows)}) AS t("idx", "geojson")
        WHERE NOT ST_IsValid(
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(t."geojson"), 4326))
        )`;
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

/**
 * SQL fragment converting a GeoJSON LineString (the split "blade") into a
 * PostGIS `geometry(LineString, 4326)`. Used as the second argument to
 * `ST_Split` in `splitParcelGeoJsonSql`.
 */
export function lineSql(line: LineString): Prisma.Sql {
    const json = JSON.stringify(line);
    return Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)`;
}

/**
 * Full query: the geometric UNION of the named parcels, returned as a
 * single GeoJSON MultiPolygon string (column `geojson`). Tenant- AND
 * location-scoped — only non-deleted parcels of `locationId` belonging to
 * `tenantId` are unioned, so a caller can never merge across a tenant or
 * field boundary. Run via `$queryRaw`; one row, `geojson` NULL when no
 * matching parcel has geometry.
 */
export function unionParcelsGeoJsonSql(
    locationId: string,
    tenantId: string,
    parcelIds: string[],
): Prisma.Sql {
    return Prisma.sql`
        SELECT ST_AsGeoJSON(ST_Multi(ST_Union("geometry"))) AS "geojson"
        FROM "Parcel"
        WHERE "id" IN (${Prisma.join(parcelIds)})
          AND "locationId" = ${locationId}
          AND "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND "geometry" IS NOT NULL`;
}

/**
 * Full query: SPLIT a parcel's geometry along a LineString blade, dumping
 * the resulting pieces to one GeoJSON polygon per row (column `geojson`).
 * `ST_Split` returns a collection; `ST_Dump` expands it; the outer filter
 * keeps only polygonal pieces (the blade itself can surface otherwise).
 * Tenant-scoped on the source parcel. When the blade does not fully cross
 * the parcel, `ST_Split` yields a single piece — the caller treats
 * `< 2 rows` as "the cut didn't divide the parcel".
 */
export function splitParcelGeoJsonSql(
    parcelId: string,
    tenantId: string,
    line: LineString,
): Prisma.Sql {
    return Prisma.sql`
        SELECT ST_AsGeoJSON((d).geom) AS "geojson"
        FROM (
            SELECT (ST_Dump(ST_Split("geometry", ${lineSql(line)}))).*
            FROM "Parcel"
            WHERE "id" = ${parcelId}
              AND "tenantId" = ${tenantId}
              AND "deletedAt" IS NULL
              AND "geometry" IS NOT NULL
        ) d
        WHERE ST_GeometryType((d).geom) IN ('ST_Polygon', 'ST_MultiPolygon')`;
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
