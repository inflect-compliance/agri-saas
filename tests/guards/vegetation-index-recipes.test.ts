/**
 * Ratchet — vegetation-index EE recipes render legibly.
 *
 * REGRESSION CLASS
 * ----------------
 * On 2026-07-02 the NDWI overlay rendered as a UNIFORM BROWN block for every
 * date. Root cause: NDWI (McFeeters) = (Green − NIR)/(Green + NIR) is
 * NEGATIVE over vegetated/soil fields (NIR ≫ Green), but its `getMap`
 * display window was `min: 0, max: 0.8` — so every land pixel fell below
 * `min` and clamped to the single low-end colour. The overlay "worked" (a
 * tile URL came back, the raster drew) but carried NO information.
 *
 * A pixel-level assertion would need a live Earth Engine call, so instead we
 * ratchet the INVARIANT that failed: the display window `[min, max]` must
 * actually SPAN each index's physical value range over agricultural land.
 * If it doesn't, the palette can't represent the data and the overlay reads
 * flat. This is pure data (`INDEX_RECIPES` carries no `@google/earthengine`
 * import) so the guard is fast + DB-free.
 *
 * `CROP_VALUE_RANGE` is the documented [low, high] a healthy-to-sparse crop
 * field produces for each index (see `index-recipes.ts` comments + the band
 * physics). The window must (a) contain the range's midpoint — the buggy
 * NDWI window failed this — and (b) cover the majority of the range so the
 * ramp isn't mostly wasted on values the AOI never reaches.
 */
import {
    INDEX_RECIPES,
    type IndexBandMath,
} from '@/lib/agro/index-recipes';
import {
    VEGETATION_INDICES,
    type VegetationIndex,
} from '@/lib/agro/vegetation-indices';

/** Physical value range each index produces over agricultural land. */
const CROP_VALUE_RANGE: Record<VegetationIndex, [number, number]> = {
    ndvi: [0.1, 0.85],
    // NEGATIVE over land — the invariant the 2026-07-02 bug violated.
    ndwi: [-0.6, 0.3],
    ndre: [0.05, 0.45],
    gndvi: [0.2, 0.7],
    evi: [0.1, 0.6],
};

/** Band pairs the ratio indices MUST use (documented formulae). */
const EXPECTED_ND_BANDS: Partial<Record<VegetationIndex, [string, string]>> = {
    ndvi: ['B8', 'B4'],
    ndwi: ['B3', 'B8'],
    ndre: ['B8', 'B5'],
    gndvi: ['B8', 'B3'],
};

const ALL_IDS = VEGETATION_INDICES.map((v) => v.id);

describe('vegetation-index recipes', () => {
    it('every catalogued index has a recipe (and vice versa)', () => {
        for (const id of ALL_IDS) {
            expect(INDEX_RECIPES[id]).toBeDefined();
        }
        expect(Object.keys(INDEX_RECIPES).sort()).toEqual([...ALL_IDS].sort());
    });

    describe.each(ALL_IDS)('%s', (id) => {
        const recipe = INDEX_RECIPES[id];
        const [lo, hi] = CROP_VALUE_RANGE[id];

        it('has a sane display window (min < max) and a real palette', () => {
            expect(recipe.min).toBeLessThan(recipe.max);
            expect(recipe.palette.length).toBeGreaterThanOrEqual(3);
        });

        it('display window CONTAINS the crop-value midpoint (anti-clamp guard)', () => {
            // The exact check the buggy NDWI window [0, 0.8] failed: NDWI's
            // land midpoint (~−0.15) sat outside it, so the whole field
            // clamped to one colour.
            const mid = (lo + hi) / 2;
            expect(mid).toBeGreaterThanOrEqual(recipe.min);
            expect(mid).toBeLessThanOrEqual(recipe.max);
        });

        it('display window covers ≥50% of the crop-value range', () => {
            const overlap =
                Math.min(hi, recipe.max) - Math.max(lo, recipe.min);
            const cropSpan = hi - lo;
            expect(overlap / cropSpan).toBeGreaterThanOrEqual(0.5);
        });
    });

    it('ratio indices use the documented band pairs', () => {
        for (const [id, bands] of Object.entries(EXPECTED_ND_BANDS)) {
            const math = INDEX_RECIPES[id as VegetationIndex].math;
            expect(math.kind).toBe('normalizedDifference');
            expect((math as Extract<IndexBandMath, { kind: 'normalizedDifference' }>).bands).toEqual(bands);
        }
    });

    it('EVI uses the enhanced-VI expression, not a band ratio', () => {
        expect(INDEX_RECIPES.evi.math.kind).toBe('evi');
    });

    it('NDWI window includes negatives (McFeeters is negative over land)', () => {
        // Direct restatement of the regression: a non-negative min here
        // re-introduces the uniform-brown bug.
        expect(INDEX_RECIPES.ndwi.min).toBeLessThan(0);
    });
});
