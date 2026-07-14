/**
 * Cadastre VECTOR parcels — pure bbox/query helpers. NO I/O, NO env.
 *
 * The free АГКК cadastre parcels source (spp.api.bg CadBaseMap MapServer/2) is
 * an ArcGIS FeatureServer-style layer whose `/query` returns GeoJSON polygons
 * reprojected server-side to EPSG:4326. To render official КККР parcel
 * boundaries UNDER the tenant's own fields, the same-origin proxy route fetches
 * the current map viewport's parcels as a GeoJSON `FeatureCollection` and
 * MapLibre draws them as a thin boundary line layer.
 *
 * Everything here is deterministic + side-effect-free so it unit-tests without
 * a network, DB, or env — the route composes it with the upstream fetch + Redis
 * cache. Env resolution lives in `cadastre-source.ts` (server-only); this module
 * never reads `process.env`.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';

/** lon/lat bbox `[west, south, east, north]` (EPSG:4326, degrees). */
export type Bbox = [number, number, number, number];

/**
 * Bulgaria's lon/lat envelope for the VECTOR parcels overlay. Slightly wider
 * than the raster envelope in `cadastre-tiles.ts` (lon 22–29, lat 41–44.5) so a
 * boundary field near the border is never clipped. A bbox that does NOT
 * intersect this box is refused (empty FeatureCollection) before any upstream
 * fetch — the cadastre only covers Bulgaria, so a request outside it is either a
 * bug or an abuse probe.
 */
export const CADASTRE_PARCELS_ENVELOPE = {
    west: 22.0,
    south: 41.0,
    east: 29.0,
    north: 44.5,
} as const;

/**
 * Maximum bbox span (degrees) the parcels proxy will serve, per axis. Parcels
 * are only useful zoomed in (the client gates fetches at zoom ~15, where a
 * viewport is well under this). A larger span means a low-zoom request would
 * try to pull much of the country's 1.2M parcels — the cap refuses those
 * (empty FeatureCollection) so a single request can never fan across a region.
 * 0.2° ≈ 15–22 km depending on latitude — comfortably above one phone viewport
 * at zoom 15, comfortably below a regional view.
 */
export const MAX_PARCELS_BBOX_SPAN_DEG = 0.2;

/** Default cap on features returned by a single upstream `/query`. */
export const PARCELS_RESULT_RECORD_COUNT = 3000;

/**
 * Parse a `bbox=west,south,east,north` query value into a validated `Bbox`.
 * Returns `null` when the value is missing, not four numbers, non-finite, or
 * degenerate (west ≥ east or south ≥ north) — the route answers those with a
 * 400 (a malformed request, distinct from a well-formed but out-of-bounds one).
 */
export function parseBbox(raw: string | null): Bbox | null {
    if (!raw) return null;
    const parts = raw.split(',').map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [west, south, east, north] = parts;
    if (west >= east || south >= north) return null;
    return [west, south, east, north];
}

/**
 * True when the bbox intersects Bulgaria's envelope (standard AABB overlap).
 * A bbox fully north/south/east/west of the envelope is out.
 */
export function isBboxInBulgaria([west, south, east, north]: Bbox): boolean {
    return !(
        east < CADASTRE_PARCELS_ENVELOPE.west ||
        west > CADASTRE_PARCELS_ENVELOPE.east ||
        north < CADASTRE_PARCELS_ENVELOPE.south ||
        south > CADASTRE_PARCELS_ENVELOPE.north
    );
}

/** True when BOTH bbox spans are within the per-axis cap (bounds abuse). */
export function isBboxWithinSpanCap([west, south, east, north]: Bbox): boolean {
    return east - west <= MAX_PARCELS_BBOX_SPAN_DEG && north - south <= MAX_PARCELS_BBOX_SPAN_DEG;
}

/**
 * Redis cache key for a parcels response. The bbox is rounded to 3 decimals
 * (~100 m) so nearby pans collapse onto the same cached extent — the bbox space
 * is continuous, so an unrounded key would never hit. Keyed off the rounded
 * corners only (the outFields + record cap are fixed for this route).
 */
export function cadastreParcelsCacheKey(bbox: Bbox): string {
    const r = bbox.map((n) => n.toFixed(3)).join(',');
    return `cadastre:parcels:${r}`;
}

/**
 * Build the ArcGIS `/query` URL for a viewport bbox — the verified request shape
 * for spp.api.bg CadBaseMap MapServer/2: an `esriGeometryEnvelope` intersect in
 * 4326, GeoJSON out, reprojected to 4326 server-side, trimmed `outFields`, and a
 * `resultRecordCount` cap. `baseUrl` is the operator-configured layer base
 * (`…/MapServer/2`); it never reaches the client.
 */
export function buildCadastreParcelsQueryUrl(
    baseUrl: string,
    bbox: Bbox,
    recordCount: number = PARCELS_RESULT_RECORD_COUNT,
): string {
    const base = baseUrl.replace(/\/$/, '');
    const qp = new URLSearchParams({
        where: '1=1',
        geometry: bbox.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        returnGeometry: 'true',
        outFields: 'upi,ekatte,nusetype',
        resultRecordCount: String(recordCount),
        f: 'geojson',
    });
    return `${base}/query?${qp.toString()}`;
}

/** An empty GeoJSON FeatureCollection — the graceful-degrade payload. */
export function emptyFeatureCollection(): FeatureCollection {
    return { type: 'FeatureCollection', features: [] };
}

/** The subset of parcel properties the client sees. */
interface TrimmedParcelProps {
    upi: string | null;
    ekatte: string | null;
    nusetype: string | null;
}

function asStringOrNull(v: unknown): string | null {
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

/**
 * Normalise an upstream GeoJSON payload into a FeatureCollection whose features
 * carry ONLY `{ upi, ekatte, nusetype }` — dropping every other upstream
 * attribute (privacy + payload weight). A payload that isn't a
 * FeatureCollection with a features array yields an empty collection, so a
 * shape surprise degrades to "no parcels" rather than throwing.
 */
export function trimParcelFeatureCollection(json: unknown): FeatureCollection {
    if (
        !json ||
        typeof json !== 'object' ||
        (json as { type?: unknown }).type !== 'FeatureCollection' ||
        !Array.isArray((json as { features?: unknown }).features)
    ) {
        return emptyFeatureCollection();
    }
    const features = (json as { features: unknown[] }).features
        .filter(
            (f): f is Feature =>
                !!f && typeof f === 'object' && (f as { geometry?: unknown }).geometry != null,
        )
        .map((f): Feature<Geometry, TrimmedParcelProps> => {
            const props = (f.properties ?? {}) as Record<string, unknown>;
            return {
                type: 'Feature',
                geometry: f.geometry,
                properties: {
                    upi: asStringOrNull(props.upi),
                    ekatte: asStringOrNull(props.ekatte),
                    nusetype: asStringOrNull(props.nusetype),
                },
            };
        });
    return { type: 'FeatureCollection', features };
}
