/**
 * RQ-4 — scenario override application + ROI (pure). No DB.
 */
import { applyOverrides, computeRoi, type ScenarioRisk } from '@/app-layer/usecases/risk-scenario';

const baseRisk = (id: string): ScenarioRisk => ({
    id, title: id, ale: 0,
    fair: { threatEventFrequency: 10, vulnerabilityProbability: 0.5, primaryLossMagnitude: 100_000 },
});
// initial ale for baseRisk: LEF=10×0.5=5, ALE=5×100000=500,000 (recomputed on patch)

describe('applyOverrides', () => {
    it('field patch recomputes the target risk ALE (lower vuln → lower ALE)', () => {
        const r = baseRisk('a');
        const out = applyOverrides([r], [{ riskId: 'a', field: 'vulnerabilityProbability', newValue: 0.1, rationale: 'WAF' }]);
        // LEF=10×0.1=1, ALE=1×100000=100,000
        expect(out[0].ale).toBeCloseTo(100_000, 0);
        expect(out[0].distributions).toBeUndefined(); // patched → drop distribution
    });

    it('does not mutate the input portfolio', () => {
        const r = baseRisk('a');
        applyOverrides([r], [{ riskId: 'a', field: 'vulnerabilityProbability', newValue: 0.1 }]);
        expect(r.fair.vulnerabilityProbability).toBe(0.5); // original untouched
    });

    it('synthetic override adds a virtual risk', () => {
        const out = applyOverrides([baseRisk('a')], [{
            riskId: null, synthetic: true, title: 'New reg risk',
            fairInputs: { tef: { min: 1, mode: 2, max: 4 }, vulnerability: { min: 0.2, mode: 0.4, max: 0.6 }, plm: { min: 100, mode: 200, max: 400 }, slef: { min: 0, mode: 0, max: 0 }, slm: { min: 0, mode: 0, max: 0 } },
        }]);
        expect(out).toHaveLength(2);
        expect(out[1].title).toBe('New reg risk');
        expect(out[1].distributions).toBeDefined();
    });

    it('throws on a field patch to an unknown risk', () => {
        expect(() => applyOverrides([baseRisk('a')], [{ riskId: 'ghost', field: 'threatEventFrequency', newValue: 1 }])).toThrow();
    });

    it('duplicate overrides on the same risk+field — last wins', () => {
        const out = applyOverrides([baseRisk('a')], [
            { riskId: 'a', field: 'vulnerabilityProbability', newValue: 0.3 },
            { riskId: 'a', field: 'vulnerabilityProbability', newValue: 0.1 },
        ]);
        expect(out[0].ale).toBeCloseTo(100_000, 0); // 0.1 applied last
    });
});

describe('computeRoi', () => {
    it('(baseline − scenario) / investment', () => {
        expect(computeRoi(1_440_000, 1_020_000, 130_000)).toBeCloseTo((1_440_000 - 1_020_000) / 130_000, 4);
    });
    it('null when no/zero investment', () => {
        expect(computeRoi(100, 50, null)).toBeNull();
        expect(computeRoi(100, 50, 0)).toBeNull();
    });
});
