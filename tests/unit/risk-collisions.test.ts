/**
 * RQ3-5 — cell-collision detection (pure). Cox's range-compression
 * critique: same-cell risks whose ALEs differ >10×.
 */
import { detectCellCollisions, COLLISION_RATIO_THRESHOLD } from '@/lib/risk-collisions';

const r = (id: string, l: number, i: number, ale: number | null) => ({
    id,
    title: id,
    likelihood: l,
    impact: i,
    ale,
});

describe('detectCellCollisions', () => {
    it('flags same-cell risks whose ALEs differ beyond the threshold', () => {
        const out = detectCellCollisions([r('small', 4, 5, 10_000), r('big', 4, 5, 410_000)]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            likelihood: 4,
            impact: 5,
            quantifiedCount: 2,
            minRisk: { id: 'small', ale: 10_000 },
            maxRisk: { id: 'big', ale: 410_000 },
        });
        expect(out[0].ratio).toBeCloseTo(41);
    });

    it('a tight cell is NOT a collision (threshold is exclusive)', () => {
        expect(detectCellCollisions([r('a', 3, 3, 100_000), r('b', 3, 3, 900_000)])).toHaveLength(0);
        // exactly 10× is not "more than 10×"
        expect(detectCellCollisions([r('a', 3, 3, 100_000), r('b', 3, 3, 1_000_000)])).toHaveLength(0);
        expect(COLLISION_RATIO_THRESHOLD).toBe(10);
    });

    it('different cells never collide with each other', () => {
        expect(detectCellCollisions([r('a', 2, 2, 1_000), r('b', 4, 4, 10_000_000)])).toHaveLength(0);
    });

    it('unquantified and zero-ALE risks carry no magnitude information', () => {
        expect(detectCellCollisions([r('a', 4, 5, null), r('b', 4, 5, 1_000_000)])).toHaveLength(0);
        // A €0 "estimate" would make every cell an infinite collision.
        expect(detectCellCollisions([r('a', 4, 5, 0), r('b', 4, 5, 1_000_000)])).toHaveLength(0);
    });

    it('sorts the worst compression first', () => {
        const out = detectCellCollisions([
            r('a1', 1, 1, 1_000), r('a2', 1, 1, 20_000),   // 20×
            r('b1', 5, 5, 1_000), r('b2', 5, 5, 500_000),  // 500×
        ]);
        expect(out.map((c) => `${c.likelihood}-${c.impact}`)).toEqual(['5-5', '1-1']);
    });

    it('a custom threshold widens or narrows the net', () => {
        const risks = [r('a', 2, 3, 10_000), r('b', 2, 3, 60_000)]; // 6×
        expect(detectCellCollisions(risks)).toHaveLength(0);
        expect(detectCellCollisions(risks, 5)).toHaveLength(1);
    });
});
