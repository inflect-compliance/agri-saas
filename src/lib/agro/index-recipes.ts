/**
 * Vegetation-index Earth-Engine recipes — the band math + visualisation
 * range/palette for each index, as PURE DATA (no `@google/earthengine`
 * import). `earth-engine.ts` reads these to build the EE ops + `getMap`
 * visParams; the guard test reads them to assert the display window
 * actually spans each index's physical value range.
 *
 * WHY this is split out from `earth-engine.ts`: the display `min`/`max` is
 * the difference between a legible overlay and a flat one. Moisture indices
 * (e.g. NDMI) go NEGATIVE over dry/bare or stressed fields, so a `min: 0`
 * window clamps every such pixel to the single low-end colour — the field
 * renders as one flat block for every date. (This exact bug shipped for the
 * now-removed McFeeters NDWI overlay on 2026-07-02: negative over all land,
 * `min: 0`, uniform brown.) Keeping the ranges here as plain data lets
 * `tests/guards/vegetation-index-recipes.test.ts` ratchet that each window
 * contains the index's real crop-value range, so a clamped range can never
 * ship again.
 */
import type { VegetationIndex } from '@/lib/agro/vegetation-indices';

/**
 * Per-image band math. `normalizedDifference` covers the four ratio indices
 * (a band pair, scale-invariant so raw DN is fine); `evi` is the enhanced
 * VI expression (needs true reflectance — the builder divides by the S2
 * 10000 DN scale).
 */
export type IndexBandMath =
    | { kind: 'normalizedDifference'; bands: [string, string] }
    | { kind: 'evi' };

export interface IndexRecipe {
    math: IndexBandMath;
    /** getMap display window — MUST span the index's crop-value range. */
    min: number;
    max: number;
    /** Colour ramp (low → high). */
    palette: string[];
}

export const INDEX_RECIPES: Record<VegetationIndex, IndexRecipe> = {
    // NDVI = (NIR − Red)/(NIR + Red) — canopy vigour. Positive over crops
    // (bare soil ~0.15 → dense canopy ~0.85). RdYlGn.
    ndvi: {
        math: { kind: 'normalizedDifference', bands: ['B8', 'B4'] },
        min: 0,
        max: 0.8,
        palette: [
            '#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b',
            '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837',
        ],
    },
    // NDMI = (NIR − SWIR1)/(NIR + SWIR1) — canopy/soil moisture (Gao). The
    // agriculture moisture index: it VARIES across a crop field (~ −0.2
    // dry/bare → ~ +0.4 well-watered canopy) and can be negative under water
    // stress, so the window MUST include negatives or the field clamps to one
    // colour. B8 NIR, B11 SWIR-1 (EE resamples the 20 m SWIR band at getMap
    // time). RdYlBu.
    ndmi: {
        math: { kind: 'normalizedDifference', bands: ['B8', 'B11'] },
        min: -0.3,
        max: 0.5,
        palette: [
            '#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090',
            '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695',
        ],
    },
    // NDRE = (NIR − RedEdge)/(NIR + RedEdge) — red-edge chlorophyll. Positive
    // over crops (~0.05 sparse → ~0.45 dense), saturates lower than NDVI.
    // PRGn.
    ndre: {
        math: { kind: 'normalizedDifference', bands: ['B8', 'B5'] },
        min: 0,
        max: 0.5,
        palette: [
            '#762a83', '#9970ab', '#c2a5cf', '#e7d4e8', '#f7f7f7',
            '#d9f0d3', '#a6dba0', '#5aae61', '#1b7837', '#00441b',
        ],
    },
    // GNDVI = (NIR − Green)/(NIR + Green) — green-band chlorophyll. Positive
    // over crops (~0.2 → ~0.7). YlGn.
    gndvi: {
        math: { kind: 'normalizedDifference', bands: ['B8', 'B3'] },
        min: 0,
        max: 0.8,
        palette: [
            '#ffffe5', '#f7fcb9', '#d9f0a3', '#addd8e', '#78c679',
            '#41ab5d', '#238443', '#006837', '#004529', '#00341f',
        ],
    },
    // EVI = 2.5·((NIR − Red)/(NIR + 6·Red − 7.5·Blue + 1)) — enhanced VI,
    // atmosphere/soil corrected. Positive over crops (~0.1 → ~0.6). Viridis.
    evi: {
        math: { kind: 'evi' },
        min: 0,
        max: 0.8,
        palette: [
            '#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c',
            '#28ae80', '#5ec962', '#addc30', '#c8e020', '#fde725',
        ],
    },
};
