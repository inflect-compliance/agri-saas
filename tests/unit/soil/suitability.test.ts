/**
 * Unit tests — soil-aware crop suitability (#37).
 *
 * The engine is advisory-only and catalog-driven: it must return `unknown`
 * (never a fabricated verdict) when the variety has no curated preferences or
 * the parcel has no soil, and every non-good reason must carry the advisory
 * "verify with a soil test / agronomist" tail.
 */
import {
    computeSuitability,
    parseVarietySoilDefaults,
    type VarietySoilDefaults,
} from '@/lib/soil/suitability';
import type { SoilProfile } from '@/lib/soil/types';

function soil(partial: Partial<SoilProfile>): Pick<SoilProfile, 'textureClass' | 'phH2o'> {
    return { textureClass: partial.textureClass ?? 'Loam', phH2o: partial.phH2o ?? 6.5 };
}

describe('parseVarietySoilDefaults', () => {
    it('returns null when nothing usable is present', () => {
        expect(parseVarietySoilDefaults(null)).toBeNull();
        expect(parseVarietySoilDefaults({})).toBeNull();
        expect(parseVarietySoilDefaults({ phMin: 'x', foo: 1 })).toBeNull();
    });

    it('parses a well-formed defaults object', () => {
        const d = parseVarietySoilDefaults({
            phMin: 6.0,
            phMax: 7.5,
            texturePreference: ['Loam', 'Silt loam'],
            drainagePreference: 'moderate',
        });
        expect(d).toEqual({
            phMin: 6.0,
            phMax: 7.5,
            texturePreference: ['Loam', 'Silt loam'],
            drainagePreference: 'moderate',
        });
    });
});

describe('computeSuitability — unknowns', () => {
    it('is unknown when the variety has no defaults', () => {
        expect(computeSuitability(soil({}), null).flag).toBe('unknown');
    });
    it('is unknown when the parcel has no soil', () => {
        const d: VarietySoilDefaults = { phMin: 6, phMax: 7 };
        expect(computeSuitability(null, d).flag).toBe('unknown');
    });
});

describe('computeSuitability — pH band', () => {
    const d: VarietySoilDefaults = { phMin: 6.0, phMax: 7.0 };

    it('is good inside the band', () => {
        expect(computeSuitability(soil({ phH2o: 6.5 }), d).flag).toBe('good');
    });
    it('is caution just outside the band (< 1.0)', () => {
        const r = computeSuitability(soil({ phH2o: 5.4 }), d);
        expect(r.flag).toBe('caution');
        expect(r.reason).toMatch(/soil test|agronomist/i);
    });
    it('is poor well outside the band (>= 1.0)', () => {
        const r = computeSuitability(soil({ phH2o: 4.5 }), d);
        expect(r.flag).toBe('poor');
        expect(r.reasons.length).toBeGreaterThan(0);
    });
    it('names the acidic vs alkaline direction', () => {
        expect(computeSuitability(soil({ phH2o: 8.5 }), d).reason).toMatch(/alkaline/i);
        expect(computeSuitability(soil({ phH2o: 4.5 }), d).reason).toMatch(/acidic/i);
    });
});

describe('computeSuitability — texture & drainage', () => {
    it('cautions when texture is outside the preferred set', () => {
        const d: VarietySoilDefaults = { texturePreference: ['Loam', 'Silt loam'] };
        expect(computeSuitability(soil({ textureClass: 'Sand' }), d).flag).toBe('caution');
    });
    it('is good when texture is within the preferred set', () => {
        const d: VarietySoilDefaults = { texturePreference: ['Loam', 'Silt loam'] };
        expect(computeSuitability(soil({ textureClass: 'Loam' }), d).flag).toBe('good');
    });
    it('escalates to poor on a two-step drainage gap (well vs poor)', () => {
        const d: VarietySoilDefaults = { drainagePreference: 'poor' };
        // Sand implies well-draining → two ranks from poor → poor.
        expect(computeSuitability(soil({ textureClass: 'Sand' }), d).flag).toBe('poor');
    });
    it('cautions on a one-step drainage gap (moderate vs poor)', () => {
        const d: VarietySoilDefaults = { drainagePreference: 'poor' };
        // Loam implies moderate → one rank from poor → caution.
        expect(computeSuitability(soil({ textureClass: 'Loam' }), d).flag).toBe('caution');
    });
    it('takes the worst of several checks', () => {
        const d: VarietySoilDefaults = {
            phMin: 6.0,
            phMax: 7.0,
            texturePreference: ['Loam'],
        };
        // pH way off (poor) + texture mismatch (caution) → poor.
        const r = computeSuitability(soil({ phH2o: 4.0, textureClass: 'Sand' }), d);
        expect(r.flag).toBe('poor');
        expect(r.reasons.length).toBe(2);
    });
});
