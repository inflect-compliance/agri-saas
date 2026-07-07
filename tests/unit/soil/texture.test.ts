/**
 * Unit tests — USDA soil-texture triangle classification (#37).
 *
 * Locks the boundary rules against the canonical NRCS texture calculator so
 * a future "simplification" can't silently reclassify samples. Each fixture
 * is a sand/silt/clay triple with the class the reference calculator returns.
 */
import {
    classifyUsdaTexture,
    drainageForTexture,
    USDA_TEXTURE_CLASSES,
} from '@/lib/soil/texture';

describe('classifyUsdaTexture — canonical class centroids', () => {
    // (sand, silt, clay) → expected class. Points sit well inside each region.
    const cases: Array<[number, number, number, string]> = [
        [92, 5, 3, 'Sand'],
        [82, 12, 6, 'Loamy sand'],
        [65, 25, 10, 'Sandy loam'],
        [40, 40, 20, 'Loam'],
        [20, 65, 15, 'Silt loam'],
        [8, 86, 6, 'Silt'],
        [55, 15, 30, 'Sandy clay loam'],
        [33, 34, 33, 'Clay loam'],
        [10, 57, 33, 'Silty clay loam'],
        [52, 6, 42, 'Sandy clay'],
        [6, 47, 47, 'Silty clay'],
        [20, 20, 60, 'Clay'],
    ];

    it.each(cases)('sand=%i silt=%i clay=%i → %s', (sand, silt, clay, expected) => {
        expect(classifyUsdaTexture(sand, silt, clay)).toBe(expected);
    });

    it('covers all 12 canonical classes across the fixtures', () => {
        const produced = new Set(cases.map(([s, si, c]) => classifyUsdaTexture(s, si, c)));
        for (const cls of USDA_TEXTURE_CLASSES) {
            expect(produced.has(cls)).toBe(true);
        }
    });
});

describe('classifyUsdaTexture — honest unknowns', () => {
    it('returns null for null/undefined components', () => {
        expect(classifyUsdaTexture(null, 20, 20)).toBeNull();
        expect(classifyUsdaTexture(60, undefined, 20)).toBeNull();
        expect(classifyUsdaTexture(60, 20, null)).toBeNull();
    });

    it('returns null for NaN or negative components (bad provider data)', () => {
        expect(classifyUsdaTexture(NaN, 20, 20)).toBeNull();
        expect(classifyUsdaTexture(-1, 50, 51)).toBeNull();
    });
});

describe('drainageForTexture', () => {
    it('maps sandy textures to well-draining', () => {
        expect(drainageForTexture('Sand')).toBe('well');
        expect(drainageForTexture('Sandy loam')).toBe('well');
    });
    it('maps clayey textures to poorly-draining', () => {
        expect(drainageForTexture('Clay')).toBe('poor');
        expect(drainageForTexture('Silty clay')).toBe('poor');
    });
    it('maps loam to moderate', () => {
        expect(drainageForTexture('Loam')).toBe('moderate');
    });
    it('returns null for a null texture', () => {
        expect(drainageForTexture(null)).toBeNull();
    });
});
