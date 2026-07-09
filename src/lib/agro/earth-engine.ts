/**
 * Google Earth Engine (GEE) — satellite vegetation-index tile generation
 * (server-only).
 *
 * Computes a recent cloud-masked Sentinel-2 index composite (NDVI / NDMI /
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
import { INDEX_RECIPES } from '@/lib/agro/index-recipes';

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
 * Build the per-image band-math function for `index` from its recipe.
 * `normalizedDifference` covers the four ratio indices (scale-invariant, so
 * raw S2 DN is fine); EVI is the enhanced-VI expression whose additive
 * constant needs TRUE reflectance, so each band is divided by the S2 10000
 * DN scale. `EeImage` keeps the fluent EE chain typed without leaking `any`.
 *
 * Sentinel-2 SR bands: B2 blue, B3 green, B4 red, B5 red-edge-1, B8 NIR.
 */
function bandFn(index: VegetationIndex): (img: EeImage) => EeImage {
    const math = INDEX_RECIPES[index].math;
    if (math.kind === 'normalizedDifference') {
        const bands = math.bands;
        return (img) => img.normalizedDifference(bands).rename(index.toUpperCase());
    }
    // EVI
    return (img) =>
        img
            .expression('2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
                NIR: img.select('B8').divide(10000),
                RED: img.select('B4').divide(10000),
                BLUE: img.select('B2').divide(10000),
            })
            .rename('EVI');
}

/**
 * Cloud-filtered S2_SR_HARMONIZED collection for `region`, ADAPTIVE on the
 * date window: prefer the requested `[win.start, win.end)`, but when that
 * window holds NO imagery — the common cause of a blank overlay: the wall
 * clock has run ahead of the published Sentinel-2 archive, or a cloudy stretch
 * emptied the window — fall back to a same-length window ending on the LATEST
 * available acquisition. So the composite is never empty while ANY recent
 * imagery exists, and the date picker still drives the window when data is
 * there. `ee` is untyped; the fluent chain is `EeImage`.
 */
function adaptiveS2Collection(region: EeImage, win: NdviWindow): EeImage {
    // `ee.Date` / `ee.Algorithms` (and the object-arg ImageCollection ctor) are
    // real EE members missing from the `EarthEngine` type defs — reach them
    // through a narrow typed view rather than `any`.
    const eeX = ee as unknown as {
        Date: (v: unknown) => EeImage;
        Algorithms: { If: (cond: unknown, t: unknown, f: unknown) => EeImage };
        ImageCollection: (v: unknown) => EeImage;
    };
    const base = ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60));
    const windowColl = base.filterDate(win.start, win.end);
    const windowDays = Math.max(1, Math.round((Date.parse(win.end) - Date.parse(win.start)) / 86_400_000));
    const latest = eeX.Date(base.sort('system:time_start', false).first().get('system:time_start'));
    const fallback = base.filterDate(latest.advance(-windowDays, 'day'), latest.advance(1, 'day'));
    return eeX.ImageCollection(eeX.Algorithms.If(windowColl.size().gt(0), windowColl, fallback));
}

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

    const recipe = INDEX_RECIPES[index];
    const band = bandFn(index);
    const region = ee.Geometry.Rectangle([aoi.west, aoi.south, aoi.east, aoi.north]);

    const collection = adaptiveS2Collection(region, win);

    // SCL classes to mask: 3 cloud-shadow, 8 cloud-medium, 9 cloud-high,
    // 10 thin-cirrus, 11 snow/ice. `EeImage` keeps the fluent EE chain
    // typed (every method returns another EE object) without leaking
    // `any` — the `@google/earthengine` module itself is untyped.
    const masked = collection.map((img: EeImage) => {
        const scl = img.select('SCL');
        const keep = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
        return img.updateMask(keep);
    });

    const composite: EeImage = masked.map((img: EeImage) => band(img)).median().clip(region);

    const visParams = { min: recipe.min, max: recipe.max, palette: recipe.palette };

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

/** Field-area mean vegetation-index readings (the AI-briefing input). */
export interface FieldIndexMeans {
    /**
     * Mean NDVI over the AOI for the window, rounded to 3 dp. Range −1..1;
     * healthy dense canopy ≈ 0.6–0.9, bare/senescent ≈ 0.1–0.3. `null` when
     * the composite yielded no clear pixels over the AOI.
     */
    ndvi: number | null;
    /**
     * Mean NDMI (moisture) over the AOI, rounded to 3 dp. Range −1..1; lower
     * values indicate drier canopy / water stress. `null` when unavailable.
     */
    ndmi: number | null;
}

/**
 * Compute the field-area MEAN NDVI + NDMI for `aoi` over the `[start, end)`
 * window — the numeric counterpart to `getIndexTileUrl` (which renders tiles).
 *
 * Same cloud-masked Sentinel-2 median composite the tile path uses, but
 * instead of `getMap` it runs a single `reduceRegion(mean)` over the AOI
 * rectangle (both index bands in one reduce → one EE round-trip). Returns a
 * plain `{ ndvi, ndmi }` value so the AI field-briefing usecase can reason
 * over concrete numbers. Throws on an EE failure (the caller treats a throw
 * as "no satellite reading for this field" and degrades gracefully).
 */
export async function getIndexMeansForBounds(
    aoi: NdviAoi,
    win: NdviWindow,
): Promise<FieldIndexMeans> {
    await initEarthEngine();

    const region = ee.Geometry.Rectangle([aoi.west, aoi.south, aoi.east, aoi.north]);

    const collection = adaptiveS2Collection(region, win);

    // Same SCL cloud/shadow/snow mask as the tile pipeline.
    const masked = collection.map((img: EeImage) => {
        const scl = img.select('SCL');
        const keep = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
        return img.updateMask(keep);
    });

    const ndviBand = bandFn('ndvi');
    const ndmiBand = bandFn('ndmi');
    const ndvi = masked.map((img: EeImage) => ndviBand(img)).median();
    const ndmi = masked.map((img: EeImage) => ndmiBand(img)).median();
    // One multi-band image → a single reduceRegion returns both means.
    const combined = (ndvi as EeImage).addBands(ndmi).clip(region);

    const reduced = (
        combined as unknown as {
            reduceRegion: (args: Record<string, unknown>) => {
                evaluate: (cb: (value: unknown, err?: unknown) => void) => void;
            };
        }
    ).reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: region,
        // 20 m keeps the reduce cheap over a whole-field box; NDVI/NDMI are
        // slowly-varying so 20 m vs the native 10 m is immaterial for a mean.
        scale: 20,
        maxPixels: 1e9,
        bestEffort: true,
    });

    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
        reduced.evaluate((value: unknown, err?: unknown) => {
            if (err) {
                reject(new Error(`EE reduceRegion failed: ${String(err)}`));
                return;
            }
            resolve((value ?? {}) as Record<string, unknown>);
        });
    });

    const round3 = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

    // Band names are the uppercased index names from `bandFn`'s `.rename(...)`.
    return { ndvi: round3(info.NDVI), ndmi: round3(info.NDMI) };
}

/**
 * Per-PARCEL variant of {@link getIndexMeansForBounds} (#13). Identical
 * masked-median-composite reduce, but the region is the parcel's exact
 * geometry (a GeoJSON Polygon / MultiPolygon) rather than a location bbox — so
 * the NDVI/NDMI means describe just that field, not the whole location's
 * bounding box. Throws on an EE failure; the caller degrades to "no reading".
 */
export async function getIndexMeansForPolygon(
    geometry: unknown,
    win: NdviWindow,
): Promise<FieldIndexMeans> {
    await initEarthEngine();

    // `ee.Geometry(geojson)` accepts a GeoJSON geometry object directly.
    const region = new (ee.Geometry as unknown as { new (g: unknown): EeImage })(geometry);

    const collection = adaptiveS2Collection(region, win);

    const masked = collection.map((img: EeImage) => {
        const scl = img.select('SCL');
        const keep = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
        return img.updateMask(keep);
    });

    const ndviBand = bandFn('ndvi');
    const ndmiBand = bandFn('ndmi');
    const ndvi = masked.map((img: EeImage) => ndviBand(img)).median();
    const ndmi = masked.map((img: EeImage) => ndmiBand(img)).median();
    const combined = (ndvi as EeImage).addBands(ndmi).clip(region);

    const reduced = (
        combined as unknown as {
            reduceRegion: (args: Record<string, unknown>) => {
                evaluate: (cb: (value: unknown, err?: unknown) => void) => void;
            };
        }
    ).reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: region,
        scale: 20,
        maxPixels: 1e9,
        bestEffort: true,
    });

    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
        reduced.evaluate((value: unknown, err?: unknown) => {
            if (err) {
                reject(new Error(`EE reduceRegion failed: ${String(err)}`));
                return;
            }
            resolve((value ?? {}) as Record<string, unknown>);
        });
    });

    const round3 = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

    return { ndvi: round3(info.NDVI), ndmi: round3(info.NDMI) };
}

// Per-index named exports — one per `/agro/<index>-tiles` route. Each is a
// thin wrapper over `getIndexTileUrl` so a route (and its unit test) can
// import + mock a single stable function.
export const getNdviTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('ndvi', aoi, win);
export const getNdmiTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('ndmi', aoi, win);
export const getNdreTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('ndre', aoi, win);
export const getGndviTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('gndvi', aoi, win);
export const getEviTileUrl = (aoi: NdviAoi, win: NdviWindow): Promise<string> =>
    getIndexTileUrl('evi', aoi, win);
