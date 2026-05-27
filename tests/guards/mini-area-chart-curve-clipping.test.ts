/**
 * MiniAreaChart — bottom-padding regression guard.
 *
 * `curveNatural` (the spline curve used for every KPI-card
 * sparkline + every dashboard hero trend line) can overshoot the
 * data minimum by a few pixels at steep down-slopes. The SVG
 * viewBox is sized to `host height`, the drawable region inside
 * is `host height − padding.top − padding.bottom`. If
 * `padding.bottom` is too small, the overshoot at the lowest data
 * points + the 1.5px stroke get clipped by the SVG bottom edge —
 * the lower end of the curve fades to invisibility.
 *
 * Locked here so a future "shrink the padding to give the curve
 * more area" tweak comes paired with a written reason. Bumping
 * the floor below 4 needs to also switch the curve type to a
 * non-overshooting alternative (e.g. `curveMonotoneX`) — adjusting
 * one without the other re-surfaces the bug.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf-8");

describe("MiniAreaChart — curve clipping floor", () => {
    const src = () => read("src/components/ui/mini-area-chart.tsx");

    it("DEFAULT_PADDING.bottom is >= 4 (room for curveNatural overshoot + 1.5px stroke)", () => {
        const match = src().match(
            /DEFAULT_PADDING\s*=\s*\{[^}]*bottom:\s*(\d+)/,
        );
        expect(match).not.toBeNull();
        const bottom = Number.parseInt(match![1], 10);
        expect(bottom).toBeGreaterThanOrEqual(4);
    });

    it("DEFAULT_PADDING.top is >= 4 (same constraint at the top)", () => {
        // The curve also overshoots ABOVE the maximum. Top padding
        // protects that. The original value was 6 (extra clearance
        // because labels render above the chart); keep ≥4 as the
        // hard floor.
        const match = src().match(
            /DEFAULT_PADDING\s*=\s*\{[^}]*top:\s*(\d+)/,
        );
        expect(match).not.toBeNull();
        const top = Number.parseInt(match![1], 10);
        expect(top).toBeGreaterThanOrEqual(4);
    });

    it("still uses curveNatural (the curve type that motivates the padding)", () => {
        // If a future PR swaps to a non-overshooting curve like
        // `curveMonotoneX`, the bottom/top padding floors above
        // can safely lower. Switching the curve without dropping
        // the floors is harmless; dropping the floors without
        // switching the curve is the regression we're guarding.
        expect(src()).toMatch(/curveNatural/);
    });
});
