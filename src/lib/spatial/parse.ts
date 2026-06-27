/**
 * Spatial-file parser — converts an uploaded parcel-boundary file into
 * a normalized list of parcels ready to persist.
 *
 * Supported inputs (all normalized to WGS84 / EPSG:4326 GeoJSON):
 *   • GeoJSON  (.geojson / .json)  — assumed 4326 per RFC 7946.
 *   • KML / KMZ (.kml / .kmz)      — 4326 by the KML spec; via @tmcw/togeojson.
 *   • ESRI Shapefile ZIP (.zip)    — via shpjs.
 *
 * Pure module: no Prisma, no I/O beyond the provided Buffer/string, so
 * it is unit-testable in isolation. The repository layer is responsible
 * for persisting the result (geometry through src/lib/db/geo.ts) and
 * for computing area via PostGIS ST_Area.
 *
 * Licensing: shpjs (MIT) and @tmcw/togeojson (BSD-2) are permissively
 * licensed; no GPL/AGPL farm-repo code is used here.
 */
import bbox from '@turf/bbox';
import { DOMParser } from '@xmldom/xmldom';
import type {
    Feature,
    FeatureCollection,
    Geometry,
    MultiPolygon,
    Polygon,
} from 'geojson';

export type SpatialFormat = 'geojson' | 'kml' | 'shapefile';

/** One normalized parcel extracted from the source file. */
export interface ParsedParcel {
    /** Best-effort name from common property keys, else a positional fallback. */
    name: string;
    /** Always a MultiPolygon in WGS84 (Polygon inputs are wrapped). */
    geometry: MultiPolygon;
    /** Source-feature properties, JSON-sanitised (Dates→ISO, NaN→null). */
    properties: Record<string, unknown>;
}

export interface ParseResult {
    format: SpatialFormat;
    parcels: ParsedParcel[];
    /** [west, south, east, north] in WGS84, or null when no geometry. */
    bounds: [number, number, number, number] | null;
    /** Features skipped because they had no polygonal geometry. */
    skipped: number;
}

export class SpatialParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpatialParseError';
    }
}

/**
 * Coerce a parsed source value into something that survives JSON
 * serialization into `Parcel.propertiesJson`. DBF parsers (shpjs) emit
 * native `Date` objects for date columns — blank cells become
 * `new Date('Invalid Date')` — and numeric columns can yield `NaN`.
 * Prisma rejects BOTH inside a JSON value, which previously failed the
 * whole import. We normalize: valid Date → ISO string, invalid Date →
 * null, non-finite number → null, recursing through arrays/objects.
 */
function toJsonSafe(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        const t = value.getTime();
        return Number.isNaN(t) ? null : value.toISOString();
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map(toJsonSafe);
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = toJsonSafe(v);
        }
        return out;
    }
    // functions / symbols → drop
    return null;
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'label', 'parcel', 'PARCEL', 'field', 'FIELD', 'id', 'ID'];
// Cadastral / area-code keys. When one is present alongside a NAME_KEYS value it
// PREFIXES the name (EKATTE 15655 + NAME 3 → "15655-3"), so cadastral exports
// get a unique, human-meaningful label instead of a bare block number. The
// composition is Unicode-safe — a Cyrillic name is preserved verbatim.
const CODE_KEYS = ['EKATTE', 'ekatte', 'CADASTRE', 'cadastre', 'KVS', 'kvs', 'REGION', 'region', 'BLOCK', 'block', 'ZONE', 'zone'];

/** First non-empty string/number value among `keys`, trimmed; else null. */
function pickValue(properties: Record<string, unknown>, keys: readonly string[]): string | null {
    for (const key of keys) {
        const v = properties[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return null;
}

function pickName(properties: Record<string, unknown>, index: number): string {
    const name = pickValue(properties, NAME_KEYS);
    const code = pickValue(properties, CODE_KEYS);
    if (code && name && code !== name) return `${code}-${name}`;
    return name ?? code ?? `Parcel ${index + 1}`;
}

/** Coerce a Polygon or MultiPolygon into MultiPolygon; reject anything else. */
function toMultiPolygon(geometry: Geometry | null | undefined): MultiPolygon | null {
    if (!geometry) return null;
    if (geometry.type === 'MultiPolygon') {
        return geometry as MultiPolygon;
    }
    if (geometry.type === 'Polygon') {
        return { type: 'MultiPolygon', coordinates: [(geometry as Polygon).coordinates] };
    }
    if (geometry.type === 'GeometryCollection') {
        // Merge any polygonal members into a single MultiPolygon.
        const polys: Polygon['coordinates'][] = [];
        for (const g of geometry.geometries) {
            if (g.type === 'Polygon') polys.push((g as Polygon).coordinates);
            else if (g.type === 'MultiPolygon') polys.push(...(g as MultiPolygon).coordinates);
        }
        return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
    }
    return null;
}

/**
 * Normalize a GeoJSON FeatureCollection / Feature / geometry into parcels,
 * counting features dropped for lacking polygonal geometry (`skipped`) so the
 * caller can tell the user a partial import happened instead of silently
 * losing points/lines.
 */
export function normalizeToParcels(input: unknown): { parcels: ParsedParcel[]; skipped: number } {
    const features: Feature[] = collectFeatures(input);
    const parcels: ParsedParcel[] = [];
    let skipped = 0;
    for (const feature of features) {
        const mp = toMultiPolygon(feature.geometry);
        if (!mp) {
            skipped++;
            continue;
        }
        const properties = toJsonSafe(
            (feature.properties ?? {}) as Record<string, unknown>,
        ) as Record<string, unknown>;
        parcels.push({ name: pickName(properties, parcels.length), geometry: mp, properties });
    }
    return { parcels, skipped };
}

function collectFeatures(input: unknown): Feature[] {
    if (!input || typeof input !== 'object') return [];
    const obj = input as { type?: string };
    if (obj.type === 'FeatureCollection') {
        return ((input as FeatureCollection).features ?? []).filter(Boolean);
    }
    if (obj.type === 'Feature') {
        return [input as Feature];
    }
    // Bare geometry → synthesize a feature.
    if (typeof obj.type === 'string') {
        return [{ type: 'Feature', properties: {}, geometry: input as Geometry }];
    }
    // shpjs may return an array of FeatureCollections (one per layer).
    if (Array.isArray(input)) {
        return input.flatMap((part) => collectFeatures(part));
    }
    return [];
}

function computeBounds(parcels: ParsedParcel[]): [number, number, number, number] | null {
    if (!parcels.length) return null;
    const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: parcels.map((p) => ({ type: 'Feature', properties: {}, geometry: p.geometry })),
    };
    const [w, s, e, n] = bbox(fc);
    if ([w, s, e, n].some((v) => !Number.isFinite(v))) return null;
    return [w, s, e, n];
}

/** Detect the spatial format from a filename + optional MIME type. */
export function detectFormat(filename: string, mimeType?: string): SpatialFormat | null {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.geojson') || lower.endsWith('.json')) return 'geojson';
    if (lower.endsWith('.kml') || lower.endsWith('.kmz')) return 'kml';
    if (lower.endsWith('.zip')) return 'shapefile';
    if (mimeType === 'application/geo+json' || mimeType === 'application/json') return 'geojson';
    if (mimeType === 'application/vnd.google-earth.kml+xml' || mimeType === 'application/vnd.google-earth.kmz') {
        return 'kml';
    }
    if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') return 'shapefile';
    return null;
}

export function parseGeoJson(text: string): { parcels: ParsedParcel[]; skipped: number } {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        throw new SpatialParseError('File is not valid JSON.');
    }
    return normalizeToParcels(json);
}

export function parseKml(text: string): { parcels: ParsedParcel[]; skipped: number } {
    // togeojson needs a DOM Document; @xmldom/xmldom provides one in Node.
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    // Lazy require keeps the CJS build out of the module's static graph.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { kml } = require('@tmcw/togeojson') as typeof import('@tmcw/togeojson');
    const fc = kml(doc as unknown as Document);
    return normalizeToParcels(fc);
}

export async function parseShapefileZip(
    buffer: Buffer,
): Promise<{ parcels: ParsedParcel[]; skipped: number }> {
    // shpjs is a browser-oriented bundle that references the `self`
    // global; polyfill it before loading so it runs server-side. Dynamic
    // import (after the polyfill) avoids static-hoisting the reference.
    const g = globalThis as unknown as { self?: unknown };
    if (typeof g.self === 'undefined') g.self = globalThis;
    const mod = (await import('shpjs')) as unknown as {
        default?: (b: ArrayBuffer | Buffer) => Promise<unknown>;
    };
    const shp = mod.default ?? (mod as unknown as (b: ArrayBuffer | Buffer) => Promise<unknown>);
    const geojson = await shp(buffer);
    return normalizeToParcels(geojson);
}

/**
 * Top-level entry: parse an uploaded spatial file into normalized
 * parcels + a bounding box. Throws SpatialParseError on unsupported
 * format or when no polygonal features are found.
 */
export async function parseSpatialFile(args: {
    filename: string;
    buffer: Buffer;
    mimeType?: string;
}): Promise<ParseResult> {
    const format = detectFormat(args.filename, args.mimeType);
    if (!format) {
        throw new SpatialParseError(
            'Unsupported file type. Upload a shapefile (.zip), KML (.kml), or GeoJSON (.geojson).',
        );
    }

    let extraction: { parcels: ParsedParcel[]; skipped: number };
    if (format === 'geojson') {
        extraction = parseGeoJson(args.buffer.toString('utf8'));
    } else if (format === 'kml') {
        extraction = parseKml(args.buffer.toString('utf8'));
    } else {
        extraction = await parseShapefileZip(args.buffer);
    }
    const { parcels, skipped } = extraction;

    if (!parcels.length) {
        throw new SpatialParseError('No polygon parcels found in the uploaded file.');
    }

    const bounds = computeBounds(parcels);
    // Coordinate-range guard: if shpjs (or a malformed/unsupported .prj) failed
    // to reproject, coordinates stay in the source CRS (e.g. UTM metres) and
    // would otherwise be stored as garbage lat/lon. Reject with an actionable
    // message — every WGS84 coordinate must fall within lon ±180 / lat ±90.
    if (bounds) {
        const [w, s, e, n] = bounds;
        if (w < -180 || e > 180 || s < -90 || n > 90) {
            throw new SpatialParseError(
                `Coordinates fall outside the valid WGS84 range (bounds [${w.toFixed(1)}, ${s.toFixed(1)}, ${e.toFixed(1)}, ${n.toFixed(1)}]; expected longitude -180..180, latitude -90..90). ` +
                    `The file's projection could not be reprojected to WGS84. Re-export the layer as WGS84 / EPSG:4326 and upload again.`,
            );
        }
    }

    return { format, parcels, bounds, skipped };
}
