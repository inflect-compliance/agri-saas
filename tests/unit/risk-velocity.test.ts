/**
 * RQ-9 — risk velocity (pure). No DB.
 */
import { velocityOf, classifyTrend } from '@/app-layer/usecases/risk-velocity';

describe('classifyTrend', () => {
    it('> +5% → RISING', () => expect(classifyTrend(6)).toBe('RISING'));
    it('< -5% → FALLING', () => expect(classifyTrend(-6)).toBe('FALLING'));
    it('within ±5% → STABLE', () => { expect(classifyTrend(3)).toBe('STABLE'); expect(classifyTrend(-5)).toBe('STABLE'); expect(classifyTrend(0)).toBe('STABLE'); });
});

describe('velocityOf', () => {
    it('ALE 100k → 120k → RISING with positive delta', () => {
        const v = velocityOf('r', 'R', 120_000, 100_000, 30);
        expect(v.deltaAle).toBe(20_000);
        expect(v.deltaPercent).toBeCloseTo(20, 5);
        expect(v.trend).toBe('RISING');
    });
    it('ALE 100k → 80k → FALLING', () => {
        const v = velocityOf('r', 'R', 80_000, 100_000, 30);
        expect(v.trend).toBe('FALLING');
        expect(v.deltaAle).toBe(-20_000);
    });
    it('unchanged → STABLE', () => {
        expect(velocityOf('r', 'R', 100_000, 100_000, 30).trend).toBe('STABLE');
    });
    it('no previous snapshot → zero + STABLE', () => {
        const v = velocityOf('r', 'R', 100_000, null, 30);
        expect(v.deltaAle).toBe(0);
        expect(v.deltaPercent).toBe(0);
        expect(v.trend).toBe('STABLE');
    });
    it('carries the window', () => {
        expect(velocityOf('r', 'R', 1, 1, 90).windowDays).toBe(90);
    });
});
