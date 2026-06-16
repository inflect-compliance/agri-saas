/**
 * Spatial-upload abuse limits — the cheap, PURE guards that bound the cost
 * of a parcel import before (size) and after (complexity) parsing.
 *
 * These exist because `importLocationSpatialFile` accepts an arbitrary
 * operator upload: a hostile or accidental 200 MB shapefile, or a single
 * polygon with millions of vertices, can pin a CPU and balloon PostGIS
 * `ST_Area` / `ST_GeomFromGeoJSON` cost. The size cap is checked BEFORE we
 * even parse (reject the bytes outright); the complexity cap is checked
 * AFTER parse, BEFORE persist (reject pathological geometry). Parsing
 * itself is moved off the request thread onto a time-bounded BullMQ job.
 *
 * Pure + dependency-free so it is exhaustively unit-testable.
 */
import type { ParsedParcel } from './parse';
import type { Position } from 'geojson';

/** Detected spatial format (mirrors `parse.ts`'s `SpatialFormat`). */
export type SpatialUploadFormat = 'shapefile' | 'geojson' | 'kml';

/**
 * Per-format byte caps. A zipped shapefile is the densest format (binary +
 * DBF), so it gets the tightest cap; text GeoJSON/KML are larger on the
 * wire for the same content, so they get more headroom.
 */
export const SPATIAL_UPLOAD_LIMITS: Readonly<Record<SpatialUploadFormat, number>> = {
    shapefile: 5 * 1024 * 1024, // 5 MB
    geojson: 10 * 1024 * 1024, // 10 MB
    kml: 10 * 1024 * 1024, // 10 MB
};

/** Max vertices in a SINGLE parcel (summed across every ring). */
export const MAX_PARCEL_VERTICES = 50_000;
/** Max vertices across the WHOLE import. */
export const MAX_TOTAL_VERTICES = 500_000;
/** Max parcels in one import. */
export const MAX_PARCEL_COUNT = 10_000;

/** A 30s wall-clock budget for the off-thread parse job (BullMQ job timeout). */
export const SPATIAL_PARSE_TIMEOUT_MS = 30_000;

/**
 * Rejection raised by the limit guards. Carries an HTTP-ish `statusCode`
 * (413 for too-large, 422 for too-complex/invalid) so the route surfaces a
 * precise client error rather than a 500.
 */
export class SpatialLimitError extends Error {
    constructor(
        message: string,
        readonly statusCode: 413 | 422 = 422,
    ) {
        super(message);
        this.name = 'SpatialLimitError';
    }
}

function mb(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reject an upload whose byte length exceeds its format cap. Checked BEFORE
 * parsing so a hostile file never reaches the parser. 413 Payload Too Large.
 */
export function assertUploadWithinSize(format: SpatialUploadFormat, byteLength: number): void {
    const cap = SPATIAL_UPLOAD_LIMITS[format];
    if (byteLength > cap) {
        throw new SpatialLimitError(
            `Spatial file is too large (${mb(byteLength)}; ${format} limit is ${mb(cap)}). ` +
                `Simplify or split the upload.`,
            413,
        );
    }
}

/** Count the vertices in one position ring. */
function ringVertices(ring: Position[]): number {
    return ring.length;
}

/** Total vertices across every polygon + ring of a parsed parcel. */
export function countParcelVertices(parcel: ParsedParcel): number {
    let n = 0;
    for (const polygon of parcel.geometry.coordinates) {
        for (const ring of polygon) {
            n += ringVertices(ring);
        }
    }
    return n;
}

/**
 * Reject a parsed parcel set that is pathologically complex: too many
 * parcels, any single parcel with too many vertices, or too many vertices
 * in aggregate. Checked AFTER parse, BEFORE persist. 422 Unprocessable.
 */
export function assertParcelComplexity(parcels: ReadonlyArray<ParsedParcel>): void {
    if (parcels.length > MAX_PARCEL_COUNT) {
        throw new SpatialLimitError(
            `Too many parcels (${parcels.length}; limit is ${MAX_PARCEL_COUNT}).`,
        );
    }
    let total = 0;
    for (const parcel of parcels) {
        const v = countParcelVertices(parcel);
        if (v > MAX_PARCEL_VERTICES) {
            throw new SpatialLimitError(
                `Parcel "${parcel.name}" is too complex (${v} vertices; limit is ${MAX_PARCEL_VERTICES}). ` +
                    `Simplify the geometry before importing.`,
            );
        }
        total += v;
    }
    if (total > MAX_TOTAL_VERTICES) {
        throw new SpatialLimitError(
            `Import is too complex (${total} vertices across all parcels; limit is ${MAX_TOTAL_VERTICES}).`,
        );
    }
}
