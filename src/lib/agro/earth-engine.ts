/**
 * Google Earth Engine (GEE) — satellite vegetation-index tile generation
 * (server-only).
 *
 * Computes a recent cloud-masked Sentinel-2 index composite (NDVI / NDWI /
 * NDRE / GNDVI / EVI) for a field's area-of-interest and returns an
 * EPHEMERAL XYZ tile-URL template
 * (`https://earthengine.googleapis.com/.../{z}/{x}/{y}`) via `getMap`,
 * which the MapLibre raster overlay consumes directly. GEE does both the
 * compute and the tile serving — we host no tile server.
 *
 * Every index shares the SAME pipeline (bounds → cloud-masked S2 collection
 * → per-image band math → per-pixel median → clip → `getMap`); only the
 * band math and the colour ramp differ, so they live in `INDEX_SPECS` and
 * `getIndexTileUrl` runs the common path. The per-index `get<Index>TileUrl`
 * wrappers keep a stable named export per tile-route.
 *
 * Auth is a GEE service account (`GEE_SERVICE_ACCOUNT_KEY` = the full JSON
 * key as a string; `GEE_PROJECT_ID` = the Earth-Engine-registered Cloud
 * project). Both are OPTIONAL: when either is absent `isGeeConfigured()`
 * is false and callers skip — so CI / contributor builds need no creds.
 *
 * This module is `serverExternalPackages`-listed (next.config.js) so the
 * heavy EE client never reaches the browser bundle; it is only ever
 * imported from the `/agro/<index>-tiles` routes.
 */
import ee from '@google/earthengine';
import { env } from '@/env';
import type { VegetationIndex } from '@/lib/agro/vegetation-indices';

/**
 * Loosely-typed Earth Engine value. The EE client is a fluent, deeply
 * dynamic SDK (every method returns another EE object); this keeps the
 * chain typed without leaking `any` into the module.
 */
type EeImage = { [method: string]: (...args: unknown[]) => EeImage };

/** AOI as a lon/lat bounding box — the location's parcel bounds. */
export interface NdviAoi {
    west: number;
    south: number;
    east: number;
    north: number;
}

export interface NdviWindow {
    /** Inclusive start date, `YYYY-MM-DD`. */
    start: string;
    /** Exclusive end date, `YYYY-MM-DD`. */
    end: string;
}

/** True only when BOTH the project id and service-account key are set. */
export function isGeeConfigured(): boolean {
    return Boolean(env.GEE_PROJECT_ID && env.GEE_SERVICE_ACCOUNT_KEY);
}

// Earth Engine auth + initialize is process-global and must run exactly
// once. The in-flight promise is memoised so concurrent requests share a
// single handshake; a rejection clears it so a transient failure can be
// retried on the next request rather than poisoning the process.
let initPromise: Promise<void> | null = null;

function initEarthEngine(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = new Promise<void>((resolve, reject) => {
        if (!isGeeConfigured()) {
            reject(new Error('Earth Engine is not configured'));
            return;
        }
        let key: Record<string, unknown>;
        try {
            key = JSON.parse(env.GEE_SERVICE_ACCOUNT_KEY as string);
        } catch {
            reject(new Error('GEE_SERVICE_ACCOUNT_KEY is not valid JSON'));
            return;
        }
        ee.data.authenticateViaPrivateKey(
            key,
            () => {
                ee.initialize(
                    null,
                    null,
                    () => resolve(),
                    (err: unknown) => reject(new Error(`EE initialize failed: ${String(err)}`)),
                    null,
                    env.GEE_PROJECT_ID,
                );
            },
            (err: unknown) => reject(new Error(`EE auth failed: ${String(err)}`)),
        );
    }).catch((err) => {
        initPromise = null; // allow retry on the next request
        throw err;
    });
    return initPromise;
}

/** getMap visualisation params (colour ramp over a fixed value range). */
interface VisParams {
    min: number;
    max: number;
    palette: string[];
}

/**
 * Per-index spec: the band math (applied per-image before the median
 * composite) and the colour ramp. Everything else in the pipeline is
 * shared — see `getIndexTileUrl`.
 *
 * Sentinel-2 SR bands used: B2 blue, B3 green, B4 red, B5 red-edge-1,
 * B8 NIR. `normalizedDifference` is scale-invariant (a band ratio), so
 * raw DN values are fine; EVI's additive constant needs true reflectance,
 * so its expression divides the S2 reflectance DN by the 10000 scale.
 */
const INDEX_SPECS: Record<
    VegetationIndex,
    { band: (img: EeImage) => EeImage; visParams: VisParams }
> = {
    // NDVI = (NIR − Red)/(NIR + Red) — canopy vigour. RdYlGn.
    ndvi: {
        band: (img) => img.normalizedDifference(['B8', 'B4']).rename('NDVI'),
        visParams: {
            min: 0,
            max: 0.8,
            palette: [
                '#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b',
                '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837',
            ],
        },
    },
    // NDWI (McFeeters) = (Green − NIR)/(Green + NIR) — open-water / moisture,
    // NOT the Gao SWIR vegetation-moisture form. BrBG (dry→wet).
    ndwi: {
        band: (img) => img.normalizedDifference(['B3', 'B8']).rename('NDWI'),
        visParams: {
            min: 0,
            max: 0.8,
            palette: [
                '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5',
                '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30',
            ],
        },
    },
    // NDRE = (NIR − RedEdge)/(NIR + RedEdge) — red-edge chlorophyll, more
    // sensitive than NDVI in dense/mature canopy. Saturates lower, so the
    // ramp tops out at 0.5. PRGn.
    ndre: {
        band: (img) => img.normalizedDifference(['B8', 'B5']).rename('NDRE'),
        visParams: {
            min: 0,
            max: 0.5,
            palette: [
                '#762a83', '#9970ab', '#c2a5cf', '#e7d4e8', '#f7f7f7',
                '#d9f0d3', '#a6dba0', '#5aae61', '#1b7837', '#00441b',
            ],
        },
    },
    // GNDVI = (NIR − Green)/(NIR + Green) — green-band chlorophyll index.
    // YlGn.
    gndvi: {
        band: (img) => img.normalizedDifference(['B8', 'B3']).rename('GNDVI'),
        visParams: {
            min: 0,
            max: 0.8,
            palette: [
                '#ffffe5', '#f7fcb9', '#d9f0a3', '#addd8e', '#78c679',
                '#41ab5d', '#238443', '#006837', '#004529', '#00341f',
            ],
        },
    },
    // EVI = 2.5·((NIR − Red)/(NIR + 6·Red − 7.5·Blue + 1)) — enhanced VI,
    // corrects for atmosphere + soil background. Needs true reflectance, so
    // each band is divided by the S2 10000 scale. Viridis.
    evi: {
        band: (img) =>
            img
                .expression('2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
                    NIR: img.select('B8').divide(10000),
                    RED: img.select('B4').divide(10000),
                    BLUE: img.select('B2').divide(10000),
                })
                .rename('EVI'),
        visParams: {
            min: 0,
            max: 0.8,
            palette: [
                '#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c',
                '#28ae80', '#5ec962', '#addc30', '#fde725', '#fde725',
            ],
        },
    },
};

/**
 * Build a recent cloud-masked Sentinel-2 composite of `index` for `aoi` over
 * the `[start, end)` window and return its ephemeral XYZ tile-URL template.
 *
 * Shared pipeline for every index: filter S2_SR_HARMONIZED to the bounds +
 * date window + <60% cloud, drop cloud/shadow/snow pixels via the SCL
 * scene-classification band, apply the index's per-image band math, take the
 * per-pixel median over the window (so a single cloudy pass never blanks the
 * field), clip to the AOI, and render via `getMap` with the index's ramp.
 */
export async function getIndexTileUrl(
    index: VegetationIndex,
    aoi: NdviAoi,
    win: NdviWindow,
): Promise<string> {
    await initEarthEngine();

    const spec = INDEX_SPECS[index];
    const region = ee.Geometry.Rectangle([aoi.west, aoi.south, aoi.east, aoi.north]);

    const collection = ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filterDate(win.start, win.end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60));

    // SCL classes to mask: 3 cloud-shadow, 8 cloud-medium, 9 cloud-high,
    // 10 thin-cirrus, 11 snow/ice. `EeImage` keeps the fluent EE chain
    // typed (every method returns another EE object) without leaking
    // `any` — the `@google/earthengine` module itself is untyped.
    const masked = collection.map((img: EeImage) => {
        const scl = img.select('SCL');
        const keep = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
        return img.updateMask(keep);
    });

    const composite: EeImage = masked.map((img: EeImage) => spec.band(img)).median().clip(region);

    const urlFormat = await new Promise<string>((resolve, reject) => {
        composite.getMap(
            spec.visParams,
            (map: { urlFormat?: string } | null, err?: unknown) => {
                if (err || !map?.urlFormat) {
                    reject(new Error(`EE getMap failed: ${String(err ?? 'no urlFormat')}`));
                    return;
                }
                resolve(map.urlFormat);
            },
        );
    });

    return urlFormat;
}

// Per-index named exports — one per `/agro/<index>-tiles` route. Each is a
// thin wrapper over `getIndexTileUrl` so a route (and its unit test) can
// import + mock a single stable function.
export const getNdviTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('ndvi', aoi, win);
export const getNdwiTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('ndwi', aoi, win);
export const getNdreTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('ndre', aoi, win);
export const getGndviTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('gndvi', aoi, win);
export const getEviTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('evi', aoi, win);
