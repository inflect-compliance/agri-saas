/**
 * Cadastre WMS tile math — pure, NO I/O, NO env.
 *
 * The Bulgarian cadastre (КККР / АГКК) is published as an OGC WMS, not an XYZ
 * tile service. To render it under MapLibre's raster source (which speaks
 * `{z}/{x}/{y}`), the same-origin proxy route converts each slippy tile
 * address to a Web-Mercator (EPSG:3857) bbox and issues a WMS `GetMap`
 * request for that extent.
 *
 * Everything here is deterministic and side-effect-free so it unit-tests
 * without a network, a DB, or env — the route composes it with the upstream
 * fetch + Redis cache. Env resolution lives in `cadastre-source.ts`
 * (server-only); this module never reads `process.env`.
 */

/** Web-Mercator origin shift — half the equatorial circumference (metres). */
const ORIGIN_SHIFT = 20_037_508.342_789_244;

/**
 * Minimum zoom the cadastre overlay serves. Below this the parcel outlines are
 * meaningless clutter AND a low-zoom request fans a single tile across most of
 * the country — a zoom FLOOR bounds both the noise and the upstream abuse
 * surface (a licensed №8002 endpoint is IP-metered, so unbounded low-zoom
 * crawls have a real cost).
 */
export const CADASTRE_MIN_ZOOM = 10;

/** Defensive upper bound — cadastral detail saturates well before this. */
export const CADASTRE_MAX_ZOOM = 22;

/**
 * Bulgaria's lon/lat envelope (slightly padded past the national borders so a
 * boundary field is never clipped). A tile whose extent does not intersect
 * this box is refused before any upstream fetch — the cadastre only covers
 * Bulgaria, so a request outside it is either a bug or an abuse probe.
 */
export const BULGARIA_ENVELOPE = {
    west: 22.0,
    south: 41.0,
    east: 28.7,
    north: 44.3,
} as const;

/** Longitude (deg) of a slippy tile's left edge. */
function tileToLon(x: number, z: number): number {
    return (x / 2 ** z) * 360 - 180;
}

/** Latitude (deg) of a slippy tile's TOP edge (XYZ / Google scheme). */
function tileToLat(y: number, z: number): number {
    const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Slippy tile → EPSG:3857 bbox `[minX, minY, maxX, maxY]` (metres), for the
 * WMS `BBOX` parameter. Uses the linear Web-Mercator grid directly (no
 * per-edge trig round-trip), so it is exact at every zoom.
 */
export function tileTo3857Bbox(z: number, x: number, y: number): [number, number, number, number] {
    const n = 2 ** z;
    const size = (2 * ORIGIN_SHIFT) / n;
    const minX = -ORIGIN_SHIFT + x * size;
    const maxX = -ORIGIN_SHIFT + (x + 1) * size;
    // y grows south (XYZ), so the tile's TOP is the smaller y.
    const maxY = ORIGIN_SHIFT - y * size;
    const minY = ORIGIN_SHIFT - (y + 1) * size;
    return [minX, minY, maxX, maxY];
}

/** Slippy tile → lon/lat bbox `{west, south, east, north}` (degrees). */
export function tileToLonLatBbox(
    z: number,
    x: number,
    y: number,
): { west: number; south: number; east: number; north: number } {
    return {
        west: tileToLon(x, z),
        east: tileToLon(x + 1, z),
        north: tileToLat(y, z),
        south: tileToLat(y + 1, z),
    };
}

/**
 * True when a slippy tile's extent intersects Bulgaria's envelope. Standard
 * AABB overlap test — a tile fully north/south/east/west of the envelope is
 * out. The proxy refuses (204s) any tile for which this is false.
 */
export function isTileInBulgaria(z: number, x: number, y: number): boolean {
    const t = tileToLonLatBbox(z, x, y);
    return !(
        t.east < BULGARIA_ENVELOPE.west ||
        t.west > BULGARIA_ENVELOPE.east ||
        t.north < BULGARIA_ENVELOPE.south ||
        t.south > BULGARIA_ENVELOPE.north
    );
}

/** True when the zoom is within the served range (floor + defensive ceiling). */
export function isCadastreZoomAllowed(z: number): boolean {
    return Number.isInteger(z) && z >= CADASTRE_MIN_ZOOM && z <= CADASTRE_MAX_ZOOM;
}

/**
 * Build a WMS 1.1.1 `GetMap` URL for a 256×256 EPSG:3857 tile. `baseUrl` is
 * the operator-configured GetMap endpoint (may already carry query params);
 * WMS params are appended with the correct `?`/`&` separator. Axis order for
 * EPSG:3857 under SRS (1.1.1) is easting,northing → `minX,minY,maxX,maxY`.
 */
export function buildCadastreWmsUrl(
    baseUrl: string,
    layers: string,
    bbox3857: [number, number, number, number],
): string {
    const qp = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetMap',
        LAYERS: layers,
        STYLES: '',
        SRS: 'EPSG:3857',
        BBOX: bbox3857.join(','),
        WIDTH: '256',
        HEIGHT: '256',
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
    });
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}${qp.toString()}`;
}

/**
 * True when the configured upstream is an ArcGIS REST MapServer (path ends
 * in `/MapServer`), not a classic OGC WMS. The Bulgarian АГКК публикува
 * своите кадастрални слоеве като ArcGIS REST (arcgis.cadastre.bg/.../
 * ExternalKais/ParcelsCache/MapServer) — its WMS interface is disabled (403),
 * but its dynamic `export` endpoint serves reprojected PNG tiles. We detect
 * this shape and speak ArcGIS `export` instead of WMS `GetMap`.
 */
export function isArcgisMapServer(url: string): boolean {
    return /\/MapServer\/?$/i.test(url.split('?')[0]);
}

/**
 * Build an ArcGIS REST `export` URL for a 256×256 EPSG:3857 tile. `baseUrl`
 * is the `…/MapServer` endpoint; `/export` + the image params are appended.
 * `bboxSR`/`imageSR=3857` make ArcGIS reproject its native cache (EPSG:7801
 * for АГКК) to Web-Mercator on the fly. `f=image` returns raw PNG bytes.
 */
export function buildCadastreArcgisExportUrl(
    baseUrl: string,
    bbox3857: [number, number, number, number],
): string {
    const base = baseUrl.replace(/\/$/, '');
    const qp = new URLSearchParams({
        bbox: bbox3857.join(','),
        bboxSR: '3857',
        imageSR: '3857',
        size: '256,256',
        format: 'png32',
        transparent: 'true',
        f: 'image',
    });
    return `${base}/export?${qp.toString()}`;
}

/** Redis cache key for a proxied cadastre tile. Keyed `(source, z, x, y)`. */
export function cadastreTileCacheKey(source: string, z: number, x: number, y: number): string {
    return `cadastre:tile:${source}:${z}:${x}:${y}`;
}
