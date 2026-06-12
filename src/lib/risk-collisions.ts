/**
 * RQ3-5 — matrix cell-collision detection (pure).
 *
 * Cox's range-compression critique made literal: two risks in the
 * same (likelihood, impact) cell can differ 40× in annualised loss,
 * and the matrix structurally cannot say so. This detector finds the
 * cells where that compression is hiding real money — quantified
 * risks sharing a cell whose ALEs differ by more than the threshold
 * ratio — so both the heatmap and the histogram can flag them.
 *
 * Pure module — no DB, no ctx — mirroring `@/lib/risk-coherence`
 * (whose qual↔quant vocabulary this extends from cross-cell rank
 * disagreement to within-cell magnitude disagreement).
 */

export interface CollisionRiskInput {
    id: string;
    title: string;
    likelihood: number;
    impact: number;
    /** Resolved ALE (null / ≤0 = not quantified — excluded). */
    ale: number | null;
}

export interface CellCollision {
    likelihood: number;
    impact: number;
    /** Quantified risks in the cell. */
    quantifiedCount: number;
    /** The cell's smallest-ALE quantified risk. */
    minRisk: { id: string; title: string; ale: number };
    /** The cell's largest-ALE quantified risk. */
    maxRisk: { id: string; title: string; ale: number };
    /** maxAle / minAle. */
    ratio: number;
}

/** Same-cell ALEs differing beyond this ratio are a collision. */
export const COLLISION_RATIO_THRESHOLD = 10;

/**
 * Detect every cell collision. Cells need ≥2 POSITIVELY-quantified
 * risks to compare (zero/null ALEs carry no magnitude information —
 * a €0 "estimate" would make every cell an infinite collision).
 * Sorted by ratio descending — the worst compression first.
 */
export function detectCellCollisions(
    risks: ReadonlyArray<CollisionRiskInput>,
    threshold: number = COLLISION_RATIO_THRESHOLD,
): CellCollision[] {
    const byCell = new Map<string, Array<{ id: string; title: string; ale: number }>>();
    for (const r of risks) {
        if (r.ale == null || !Number.isFinite(r.ale) || r.ale <= 0) continue;
        const key = `${r.likelihood}-${r.impact}`;
        const list = byCell.get(key) ?? [];
        list.push({ id: r.id, title: r.title, ale: r.ale });
        byCell.set(key, list);
    }

    const collisions: CellCollision[] = [];
    for (const [key, list] of byCell) {
        if (list.length < 2) continue;
        let min = list[0];
        let max = list[0];
        for (const r of list) {
            if (r.ale < min.ale) min = r;
            if (r.ale > max.ale) max = r;
        }
        const ratio = max.ale / min.ale;
        if (ratio > threshold) {
            const [likelihood, impact] = key.split('-').map(Number);
            collisions.push({
                likelihood,
                impact,
                quantifiedCount: list.length,
                minRisk: min,
                maxRisk: max,
                ratio,
            });
        }
    }
    return collisions.sort((a, b) => b.ratio - a.ratio);
}
