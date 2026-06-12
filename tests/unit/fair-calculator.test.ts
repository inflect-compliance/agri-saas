/**
 * RQ-1 — FAIR calculation core. Pure-function unit coverage of the
 * ontology math + the legacy/FAIR ALE resolver + deterministic sampling.
 */
import {
    computeLEF,
    computePLM,
    computeFairALE,
    computeTEF,
    computeVulnerability,
    sampleFairALE,
    pointToPert,
    pertMean,
    computeLegacyALE,
    resolveALE,
    seededRng,
    type FairDistributions,
} from '@/app-layer/usecases/fair-calculator';

describe('point-estimate FAIR math', () => {
    it('LEF = TEF × Vulnerability', () => {
        expect(computeLEF(12, 0.4)).toBeCloseTo(4.8, 6);
        expect(computeLEF(0, 0.5)).toBe(0); // zero frequency = zero loss
    });

    it('TEF = contact frequency × P(action)', () => {
        expect(computeTEF(24, 0.5)).toBe(12);
    });

    it('Vulnerability: high threat vs low control > 0.5; parity = 0.5', () => {
        expect(computeVulnerability(8, 3)).toBeGreaterThan(0.5);
        expect(computeVulnerability(5, 5)).toBeCloseTo(0.5, 6);
        expect(computeVulnerability(2, 8)).toBeLessThan(0.5);
    });

    it('PLM sums decomposed components, else uses the flat estimate', () => {
        expect(computePLM({ productivityLoss: 50000, responseCost: 30000, replacementCost: 20000 })).toBe(100000);
        expect(computePLM({ flatEstimate: 150000 })).toBe(150000);
        expect(computePLM({})).toBe(0);
    });

    it('Full FAIR ALE = LEF × (PLM + SLEF × SLM)', () => {
        // 4.8 × (150000 + 0.3 × 500000) = 4.8 × 300000 = 1,440,000
        expect(
            computeFairALE({ tef: 12, vulnerability: 0.4, plm: 150000, slef: 0.3, slm: 500000 }),
        ).toBeCloseTo(1_440_000, 2);
    });

    it('slef=0 ignores secondary loss entirely', () => {
        const withSec = computeFairALE({ tef: 10, vulnerability: 0.5, plm: 100000, slef: 0, slm: 999999 });
        const noSec = computeFairALE({ tef: 10, vulnerability: 0.5, plm: 100000, slef: 0, slm: 0 });
        expect(withSec).toBe(noSec);
    });
});

describe('distribution helpers', () => {
    it('pointToPert builds a ±spread triple', () => {
        expect(pointToPert(100, 0.2)).toEqual({ min: 80, mode: 100, max: 120 });
    });

    it('sampleFairALE is deterministic for a fixed seed + positive', () => {
        const dists: FairDistributions = {
            tef: { min: 4, mode: 12, max: 24 },
            vulnerability: { min: 0.2, mode: 0.4, max: 0.7 },
            plm: { min: 80000, mode: 150000, max: 300000 },
            slef: { min: 0.1, mode: 0.3, max: 0.6 },
            slm: { min: 100000, mode: 500000, max: 1000000 },
        };
        const a = sampleFairALE(dists, seededRng(42));
        const b = sampleFairALE(dists, seededRng(42));
        expect(a).toBe(b);
        expect(a).toBeGreaterThan(0);
    });
});

describe('resolveALE — FAIR ⟶ legacy ⟶ null', () => {
    it('prefers fairAle', () => {
        expect(resolveALE({ fairAle: 864000, sleAmount: 100, aroAmount: 2 })).toBe(864000);
    });
    it('falls back to SLE × ARO', () => {
        expect(resolveALE({ fairAle: null, sleAmount: 100000, aroAmount: 3 })).toBe(300000);
        expect(computeLegacyALE(100000, 3)).toBe(300000);
    });
    it('null when neither is set', () => {
        expect(resolveALE({ fairAle: null, sleAmount: null, aroAmount: null })).toBeNull();
        expect(resolveALE({ fairAle: null, sleAmount: 100, aroAmount: null })).toBeNull();
    });
});

describe('pertMean (RQ3-2) — the derived point estimate', () => {
    it('is the Beta-PERT weighted mean (min + 4·mode + max) / 6', () => {
        expect(pertMean({ min: 0.1, mode: 0.2, max: 0.6 })).toBeCloseTo(0.25);
        expect(pertMean({ min: 10_000, mode: 80_000, max: 400_000 })).toBeCloseTo(121_666.67, 0);
    });

    it('degenerate triples collapse to the point value (round-trip)', () => {
        expect(pertMean({ min: 0.3, mode: 0.3, max: 0.3 })).toBe(0.3);
        expect(pertMean(pointToPert(50_000, 0))).toBe(50_000);
    });

    it('a symmetric range means the mode', () => {
        expect(pertMean({ min: 100, mode: 200, max: 300 })).toBe(200);
    });
});
