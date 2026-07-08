/**
 * USDA soil-texture triangle — PURE classification, no I/O.
 *
 * Maps a sand/silt/clay percentage triple to one of the 12 canonical USDA
 * texture classes. The boundary rules are the standard NRCS "texture
 * calculator" ruleset (the same logic as the R `soiltexture` package and
 * the USDA online calculator), evaluated in the fixed order below so the
 * overlapping half-plane boundaries resolve deterministically.
 *
 * Percentages are the SoilGrids-derived fractions (0–100). They should sum
 * to ~100; small rounding drift is tolerated — the rules key off clay/silt/
 * sand independently, not on an exact sum. Callers that hand in nulls (a
 * grid cell the provider couldn't resolve) get `null` back, which the soil
 * layer surfaces as "soil pending", never a fabricated class.
 *
 * These are geometric definitions, not agronomic numbers — they are the
 * textbook USDA triangle, so hard-coding them here does not violate the
 * "never fabricate agronomic thresholds" rule (that rule governs crop
 * suitability, which pulls from catalog data — see `suitability.ts`).
 *
 * @module lib/soil/texture
 */

/** The 12 canonical USDA soil-texture classes (human-readable labels). */
export const USDA_TEXTURE_CLASSES = [
    'Sand',
    'Loamy sand',
    'Sandy loam',
    'Loam',
    'Silt loam',
    'Silt',
    'Sandy clay loam',
    'Clay loam',
    'Silty clay loam',
    'Sandy clay',
    'Silty clay',
    'Clay',
] as const;

export type UsdaTextureClass = (typeof USDA_TEXTURE_CLASSES)[number];

/**
 * Classify a sand/silt/clay percentage triple into a USDA texture class.
 *
 * Returns `null` when any component is null/NaN/negative — an honest
 * "unknown", never a guessed class. Order of the checks matters: the USDA
 * classes are half-plane regions of the triangle and several boundaries
 * overlap, so the first matching rule (top-to-bottom) wins, exactly as in
 * the reference calculator.
 */
export function classifyUsdaTexture(
    sandPct: number | null | undefined,
    siltPct: number | null | undefined,
    clayPct: number | null | undefined,
): UsdaTextureClass | null {
    const sand = sandPct;
    const silt = siltPct;
    const clay = clayPct;
    if (
        sand == null || silt == null || clay == null ||
        !Number.isFinite(sand) || !Number.isFinite(silt) || !Number.isFinite(clay) ||
        sand < 0 || silt < 0 || clay < 0
    ) {
        return null;
    }

    // Reference USDA ruleset (NRCS texture calculator), evaluated in order.
    if (silt + 1.5 * clay < 15) return 'Sand';
    if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return 'Loamy sand';
    if (clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) return 'Sandy loam';
    if (clay < 7 && silt < 50 && silt + 2 * clay >= 30) return 'Sandy loam';
    if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'Loam';
    if (silt >= 50 && clay >= 12 && clay < 27) return 'Silt loam';
    if (silt >= 50 && silt < 80 && clay < 12) return 'Silt loam';
    if (silt >= 80 && clay < 12) return 'Silt';
    if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'Sandy clay loam';
    if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'Clay loam';
    if (clay >= 27 && clay < 40 && sand <= 20) return 'Silty clay loam';
    if (clay >= 35 && sand > 45) return 'Sandy clay';
    if (clay >= 40 && silt >= 40) return 'Silty clay';
    if (clay >= 40 && sand <= 45 && silt < 40) return 'Clay';

    // The 12 regions tile the whole triangle; a fall-through only happens on
    // a degenerate triple (e.g. clay ~35–40 with high sand rounding). Clay is
    // the safest catch-all for a heavy, ambiguous sample.
    return 'Clay';
}

/**
 * Coarse drainage tendency IMPLIED by texture (not a measurement). Sandy
 * textures drain freely; clayey textures hold water. Used only to phrase a
 * suitability caution ("heavy soil — may drain poorly"), never presented as
 * a drainage measurement.
 */
export type DrainageTendency = 'well' | 'moderate' | 'poor';

const DRAINAGE_BY_TEXTURE: Record<UsdaTextureClass, DrainageTendency> = {
    Sand: 'well',
    'Loamy sand': 'well',
    'Sandy loam': 'well',
    Loam: 'moderate',
    'Silt loam': 'moderate',
    Silt: 'moderate',
    'Sandy clay loam': 'moderate',
    'Clay loam': 'poor',
    'Silty clay loam': 'poor',
    'Sandy clay': 'poor',
    'Silty clay': 'poor',
    Clay: 'poor',
};

/** Map a USDA texture class to its coarse drainage tendency. */
export function drainageForTexture(texture: UsdaTextureClass | null): DrainageTendency | null {
    if (!texture) return null;
    return DRAINAGE_BY_TEXTURE[texture];
}
