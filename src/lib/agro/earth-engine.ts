/**
 * Google Earth Engine (GEE) — NDVI tile generation (server-only).
 *
 * Computes a recent cloud-masked Sentinel-2 NDVI composite for a field's
 * area-of-interest and returns an EPHEMERAL XYZ tile-URL template
 * (`https://earthengine.googleapis.com/.../{z}/{x}/{y}`) via `getMap`,
 * which the MapLibre raster overlay consumes directly. GEE does both the
 * compute and the tile serving — we host no tile server.
 *
 * Auth is a GEE service account (`GEE_SERVICE_ACCOUNT_KEY` = the full JSON
 * key as a string; `GEE_PROJECT_ID` = the Earth-Engine-registered Cloud
 * project). Both are OPTIONAL: when either is absent `isGeeConfigured()`
 * is false and callers skip — so CI / contributor builds need no creds.
 *
 * This module is `serverExternalPackages`-listed (next.config.js) so the
 * heavy EE client never reaches the browser bundle; it is only ever
 * imported from the `/agro/ndvi-tiles` route.
 */
import ee from '@google/earthengine';
import { env } from '@/env';

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

/**
 * Build a recent cloud-masked Sentinel-2 NDVI composite for `aoi` over the
 * `[start, end)` window and return its ephemeral XYZ tile-URL template.
 *
 * NDVI = (B8 − B4) / (B8 + B4). Clouds/shadow/snow are dropped via the
 * Sentinel-2 SCL scene-classification band, then the per-pixel median over
 * the window is taken so a single cloudy pass never blanks the field.
 */
export async function getNdviTileUrl(aoi: NdviAoi, win: NdviWindow): Promise<string> {
    await initEarthEngine();

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

    const ndvi = masked.map((img: EeImage) =>
        img.normalizedDifference(['B8', 'B4']).rename('NDVI'),
    );

    const composite: EeImage = ndvi.median().clip(region);

    const visParams = {
        min: 0,
        max: 0.8,
        palette: [
            '#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b',
            '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837',
        ],
    };

    const urlFormat = await new Promise<string>((resolve, reject) => {
        composite.getMap(
            visParams,
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

/**
 * Build a recent cloud-masked Sentinel-2 NDWI composite for `aoi` over the
 * `[start, end)` window and return its ephemeral XYZ tile-URL template.
 *
 * NDWI (McFeeters water-index form) = (B3 − B8) / (B3 + B8), where B3 is the
 * green band and B8 the NIR band — this is the WATER index (positive over
 * open water / high moisture), distinct from the Gao vegetation-moisture NDWI
 * that uses SWIR. Clouds/shadow/snow are dropped via the Sentinel-2 SCL
 * scene-classification band (identical to the NDVI path), then the per-pixel
 * median over the window is taken so a single cloudy pass never blanks the
 * field.
 */
export async function getNdwiTileUrl(aoi: NdviAoi, win: NdviWindow): Promise<string> {
    await initEarthEngine();

    const region = ee.Geometry.Rectangle([aoi.west, aoi.south, aoi.east, aoi.north]);

    const collection = ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filterDate(win.start, win.end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60));

    // SCL classes to mask: 3 cloud-shadow, 8 cloud-medium, 9 cloud-high,
    // 10 thin-cirrus, 11 snow/ice — same mask as the NDVI composite.
    const masked = collection.map((img: EeImage) => {
        const scl = img.select('SCL');
        const keep = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
        return img.updateMask(keep);
    });

    // McFeeters NDWI = (Green − NIR)/(Green + NIR). B3 = green, B8 = NIR.
    const ndwi = masked.map((img: EeImage) =>
        img.normalizedDifference(['B3', 'B8']).rename('NDWI'),
    );

    const composite: EeImage = ndwi.median().clip(region);

    // Water-appropriate ramp: dry/low (browns) → neutral (white) → wet/high
    // (blues). Distinct from NDVI's red→green so the two overlays never read
    // the same. Same [min,max] range handling as NDVI.
    const visParams = {
        min: 0,
        max: 0.8,
        palette: [
            '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5',
            '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30',
        ],
    };

    const urlFormat = await new Promise<string>((resolve, reject) => {
        composite.getMap(
            visParams,
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
