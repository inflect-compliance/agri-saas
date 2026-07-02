/**
 * Vegetation-index Earth-Engine recipes — the band math + visualisation
 * range/palette for each index, as PURE DATA (no `@google/earthengine`
 * import). `earth-engine.ts` reads these to build the EE ops + `getMap`
 * visParams; the guard test reads them to assert the display window
 * actually spans each index's physical value range.
 *
 * WHY this is split out from `earth-engine.ts`: the display `min`/`max` is
 * the difference between a legible overlay and a flat one. McFeeters NDWI is
 * NEGATIVE over vegetated/soil fields (NIR ≫ Green), so a `min: 0` window
 * clamps every land pixel to the single low-end colour — the field renders
 * uniformly brown for every date (the bug reported 2026-07-02). Keeping the
 * ranges here as plain data lets `tests/guards/vegetation-index-recipes.test.ts`
 * ratchet that each window contains the index's real crop-value range, so a
 * clamped range can never ship again.
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
    // NDWI (McFeeters) = (Green − NIR)/(Green + NIR) — open-water / moisture.
    // NEGATIVE over land (vegetation ~ −0.6, bare soil ~ −0.2), positive only
    // over water. The window MUST include negatives or the field clamps to
    // one colour: symmetric [−0.5, 0.5] centres the land↔water boundary at 0.
    // BrBG (dry/low → wet/high).
    ndwi: {
        math: { kind: 'normalizedDifference', bands: ['B3', 'B8'] },
        min: -0.5,
        max: 0.5,
        palette: [
            '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5',
            '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30',
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
