/**
 * RQ-2 — appetite breach detection (pure `detectBreaches`). No DB.
 */
import { detectBreaches, type AppetiteRisk } from '@/app-layer/usecases/risk-appetite';

const cfg = (over: Partial<Parameters<typeof detectBreaches>[0]> = {}) => ({
    totalAleThreshold: null,
    singleRiskAleMax: null,
    qualScoreMax: null,
    categoryOverridesJson: null,
    ...over,
});
const risk = (id: string, ale: number, score = 9, category: string | null = null): AppetiteRisk => ({ id, ale, score, category });

describe('detectBreaches', () => {
    it('flags a PORTFOLIO_ALE breach when the sum exceeds the ceiling', () => {
        const r = detectBreaches(cfg({ totalAleThreshold: 2_500_000 }), [risk('a', 2_000_000), risk('b', 1_000_000)]);
        expect(r.portfolioAle).toBe(3_000_000);
        expect(r.isWithinAppetite).toBe(false);
        expect(r.breaches.some((b) => b.type === 'PORTFOLIO_ALE' && b.threshold === 2_500_000 && b.actual === 3_000_000)).toBe(true);
    });

    it('is within appetite when below threshold', () => {
        const r = detectBreaches(cfg({ totalAleThreshold: 5_000_000 }), [risk('a', 1_000_000)]);
        expect(r.isWithinAppetite).toBe(true);
        expect(r.breaches).toHaveLength(0);
    });

    it('flags a SINGLE_RISK_ALE breach', () => {
        const r = detectBreaches(cfg({ singleRiskAleMax: 500_000 }), [risk('a', 600_000), risk('b', 100_000)]);
        const b = r.breaches.find((x) => x.type === 'SINGLE_RISK_ALE');
        expect(b).toMatchObject({ riskId: 'a', threshold: 500_000, actual: 600_000 });
        expect(r.breaches.filter((x) => x.type === 'SINGLE_RISK_ALE')).toHaveLength(1);
    });

    it('flags a QUAL_SCORE breach', () => {
        const r = detectBreaches(cfg({ qualScoreMax: 15 }), [risk('a', 0, 20)]);
        expect(r.breaches.find((b) => b.type === 'QUAL_SCORE')).toMatchObject({ riskId: 'a', threshold: 15, actual: 20 });
    });

    it('category override takes precedence over the global single-risk max', () => {
        const config = cfg({ singleRiskAleMax: 1_000_000, categoryOverridesJson: { Operational: { singleAleMax: 200_000 } } });
        const r = detectBreaches(config, [risk('a', 300_000, 9, 'Operational'), risk('b', 300_000, 9, 'Strategic')]);
        const single = r.breaches.filter((x) => x.type === 'SINGLE_RISK_ALE');
        // Operational risk breaches the tighter 200k override; Strategic (300k < 1M global) does not.
        expect(single).toHaveLength(1);
        expect(single[0].riskId).toBe('a');
    });

    it('flags a CATEGORY_ALE breach from the per-category ceiling', () => {
        const config = cfg({ categoryOverridesJson: { Operational: { totalAleMax: 500_000 } } });
        const r = detectBreaches(config, [risk('a', 300_000, 9, 'Operational'), risk('b', 300_000, 9, 'Operational')]);
        expect(r.breaches.find((b) => b.type === 'CATEGORY_ALE')).toMatchObject({ category: 'Operational', threshold: 500_000, actual: 600_000 });
    });

    it('null thresholds skip their checks entirely', () => {
        const r = detectBreaches(cfg(), [risk('a', 9_999_999, 25)]);
        expect(r.breaches).toHaveLength(0);
        expect(r.isWithinAppetite).toBe(true);
    });
});

// ─── RQ3-3 — portfolio honesty: tested percentile ────────────────────

describe('detectBreaches — tested percentile (RQ3-3)', () => {
    const SIM = { 50: 400_000, 80: 700_000, 90: 850_000, 95: 1_000_000, 99: 1_400_000 };

    it('tests the ceiling at the configured percentile, not the sum of means', () => {
        // Σ(mean) = 300k — under the 500k ceiling. P80 = 700k — over.
        const r = detectBreaches(
            cfg({ totalAleThreshold: 500_000, testedPercentile: 80 }),
            [risk('a', 200_000, 9), risk('b', 100_000, 9)],
            SIM,
        );
        expect(r.portfolioAle).toBe(300_000);
        expect(r.portfolioTested).toEqual({ value: 700_000, percentile: 80, simulated: true });
        expect(r.breaches.find((b) => b.type === 'PORTFOLIO_ALE')).toMatchObject({
            threshold: 500_000,
            actual: 700_000,
        });
    });

    it('a tail-tolerant board (P50) stays within even when Σ would breach', () => {
        // Σ(mean) = 600k > 500k ceiling — but the configured P50 (400k) is under.
        const r = detectBreaches(
            cfg({ totalAleThreshold: 500_000, testedPercentile: 50 }),
            [risk('a', 400_000, 9), risk('b', 200_000, 9)],
            SIM,
        );
        expect(r.breaches.filter((b) => b.type === 'PORTFOLIO_ALE')).toHaveLength(0);
        expect(r.portfolioTested).toEqual({ value: 400_000, percentile: 50, simulated: true });
    });

    it('defaults to P80 when the config carries no percentile', () => {
        const r = detectBreaches(cfg({ totalAleThreshold: 500_000 }), [risk('a', 1, 1)], SIM);
        expect(r.portfolioTested.percentile).toBe(80);
        expect(r.portfolioTested.value).toBe(700_000);
    });

    it('falls back to Σ of means without a simulation — and says so', () => {
        const r = detectBreaches(
            cfg({ totalAleThreshold: 500_000, testedPercentile: 95 }),
            [risk('a', 600_000, 9)],
            null,
        );
        expect(r.portfolioTested).toEqual({ value: 600_000, percentile: 95, simulated: false });
        expect(r.breaches.find((b) => b.type === 'PORTFOLIO_ALE')).toMatchObject({ actual: 600_000 });
    });

    it('a missing percentile key falls back to Σ (partial pre-RQ3-1 runs)', () => {
        const r = detectBreaches(
            cfg({ totalAleThreshold: 500_000, testedPercentile: 80 }),
            [risk('a', 100_000, 9)],
            { 50: 400_000 }, // no 80 key
        );
        expect(r.portfolioTested.simulated).toBe(false);
        expect(r.portfolioTested.value).toBe(100_000);
    });

    it('per-risk and per-category checks stay on resolved ALEs', () => {
        const r = detectBreaches(
            cfg({ singleRiskAleMax: 150_000, testedPercentile: 80 }),
            [risk('a', 200_000, 9)],
            SIM,
        );
        expect(r.breaches.find((b) => b.type === 'SINGLE_RISK_ALE')).toMatchObject({ actual: 200_000 });
    });
});
