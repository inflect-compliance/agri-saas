/**
 * Roadmap-16 PR-5 — DonutChart visual rebuild on R16 primitives.
 *
 * The pre-R16 DonutChart used `stroke-dasharray` on a circle —
 * clever, dependency-free, but couldn't carry gradient fills
 * cleanly on a single segment (the gradient would apply to the
 * full circle path, not the visible arc). R16-PR5 swaps to visx's
 * `<Pie>` rendering producing real SVG arc `<path>` geometry, so
 * each segment gets its own radial gradient fill — the user's
 * "where two colours meet" foundation.
 *
 * Seven load-bearing invariants:
 *
 *   1. Imports visx Pie (the geometry source).
 *
 *   2. Imports the R16-PR2 gradient primitives
 *      (`ChartRadialGradient`, `chartGradientId`).
 *
 *   3. `DonutSegment` carries an OPTIONAL `seriesIndex: ChartSeriesIndex`
 *      field. Legacy `color: string` field preserved for back-
 *      compat — pre-R16 callers keep working.
 *
 *   4. Component renders `<Pie>` with `cornerRadius` (curved
 *      end-caps) and `padAngle` (subtle gaps between segments).
 *
 *   5. `<defs>` block renders one `<ChartRadialGradient>` per
 *      unique seriesIndex in use. Per-segment fill resolves
 *      through `url(#${gradId})` when seriesIndex is set, else
 *      falls back to legacy `seg.color`.
 *
 *   6. Gradient ids are scoped per-instance via `useId()` so
 *      multiple donuts on the same page don't collide on SVG
 *      defs.
 *
 *   7. Legacy `stroke-dasharray` per-segment rendering is GONE.
 *      A regression to the old pattern would lose gradient
 *      support.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const DONUT_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/DonutChart.tsx'),
    'utf8',
);

describe('Roadmap-16 PR-5 — DonutChart visual rebuild', () => {
    describe('imports — visx Pie + R16 gradient primitives', () => {
        it('imports Pie from @visx/shape', () => {
            // The whole rebuild rides on visx's `<Pie>` arc
            // geometry. Without it, we're back to dasharray
            // and can't carry per-segment gradient fills.
            // visx 4 ships ESM and dropped the deep
            // `@visx/shape/lib/shapes/Pie` subpath export — `Pie`
            // is now a named export of the package root.
            expect(DONUT_SRC).toMatch(
                /import\s*\{\s*Pie\s*\}\s*from\s*['"]@visx\/shape['"]/,
            );
        });

        it('imports ChartRadialGradient + chartGradientId from R16-PR2', () => {
            expect(DONUT_SRC).toMatch(
                /import\s*\{[\s\S]*?ChartRadialGradient[\s\S]*?chartGradientId[\s\S]*?\}\s*from\s*['"]@\/components\/ui\/charts\/chart-gradient['"]/,
            );
        });

        it('imports the ChartSeriesIndex type', () => {
            expect(DONUT_SRC).toMatch(
                /import\s+type\s*\{[\s\S]*?ChartSeriesIndex[\s\S]*?\}\s*from\s*['"]@\/components\/ui\/charts\/chart-gradient['"]|import\s*\{[\s\S]*?type\s+ChartSeriesIndex[\s\S]*?\}\s*from\s*['"]@\/components\/ui\/charts\/chart-gradient['"]/,
            );
        });
    });

    describe('DonutSegment — back-compat optional seriesIndex', () => {
        it('declares optional seriesIndex field of type ChartSeriesIndex', () => {
            // Optional `?:` so pre-R16 callers (color-only) still
            // type-check. New callers should reach for seriesIndex.
            expect(DONUT_SRC).toMatch(
                /seriesIndex\?\s*:\s*ChartSeriesIndex/,
            );
        });

        it('preserves the legacy color: string field', () => {
            // Back-compat: pre-R16 callers pass `color` (CSS
            // string or `var(...)`). Removing it would break
            // the 4 existing consumers.
            expect(DONUT_SRC).toMatch(/color:\s*string/);
        });
    });

    describe('rendering — Pie with cornerRadius + padAngle', () => {
        it('renders <Pie> with the data array + pieValue accessor', () => {
            expect(DONUT_SRC).toMatch(/<Pie\b/);
            expect(DONUT_SRC).toMatch(/pieValue=\{/);
        });

        it('uses cornerRadius for curved end-caps (polished, not stamped)', () => {
            // 1.5 is the locked sweet spot — larger reads as
            // bubbles, zero reads as stamped wedges.
            expect(DONUT_SRC).toMatch(/cornerRadius=\{1\.5\}/);
        });

        it('uses padAngle for subtle inter-segment gaps', () => {
            // 0.012 radians — visible enough to separate the
            // segments, small enough to avoid the "missing data"
            // illusion.
            expect(DONUT_SRC).toMatch(/padAngle=\{0\.012\}/);
        });
    });

    describe('gradient defs + per-segment fills', () => {
        it('renders <defs> block', () => {
            expect(DONUT_SRC).toMatch(/<defs>/);
        });

        it('renders one <ChartRadialGradient> per unique seriesIndex in use', () => {
            // Dedupe via Set so a single donut with two segments
            // sharing a series renders one def, not two.
            expect(DONUT_SRC).toMatch(
                /new Set\([\s\S]*?seriesIndex[\s\S]*?\)/,
            );
            expect(DONUT_SRC).toMatch(/<ChartRadialGradient\b/);
        });

        it('per-segment fill resolves via url(#...) when seriesIndex is set', () => {
            // The gradient resolution path. Without this, the
            // gradient defs are dead weight.
            expect(DONUT_SRC).toMatch(/`url\(#\$\{chartGradientId\(/);
        });

        it('per-segment fill falls back to seg.color when seriesIndex is absent', () => {
            // Back-compat. Pre-R16 callers pass `color` strings;
            // the fallback path keeps them rendering correctly.
            expect(DONUT_SRC).toMatch(
                /seg\.seriesIndex\s*!==\s*undefined[\s\S]*?:\s*seg\.color/,
            );
        });
    });

    describe('per-instance gradient id scoping', () => {
        it('uses React useId to scope gradient ids per-instance', () => {
            // Multiple donuts on the same page (e.g. dashboard)
            // would collide on SVG def ids without per-instance
            // scoping. useId returns a stable per-mount id.
            expect(DONUT_SRC).toMatch(/import\s*\{[\s\S]*?useId[\s\S]*?\}\s*from\s*['"]react['"]/);
            expect(DONUT_SRC).toMatch(/useId\(\)/);
        });

        it('sanitises useId output for SVG-id use (colons stripped)', () => {
            // useId returns `:r0:` style values — colons are
            // valid in CSS but not in SVG `id` (or rather, the
            // url(#:r0:) reference is fragile). Strip them.
            expect(DONUT_SRC).toMatch(/replace\(\/:\/g,\s*['"]['"]\)/);
        });
    });

    describe('legacy rendering removed', () => {
        it('no per-segment <circle stroke-dasharray=...>', () => {
            // The R16-PR5 rebuild replaces stroke-dasharray
            // segment rendering with <Pie> arc paths. A regression
            // to dasharray would lose gradient support.
            expect(DONUT_SRC).not.toMatch(/strokeDasharray/);
        });

        it('no transform="rotate(-90 ...)" hack on segments', () => {
            // The dasharray approach needed rotate(-90) to start
            // arcs at the top. Pie geometry handles start/end
            // angles natively.
            expect(DONUT_SRC).not.toMatch(/rotate\(-90/);
        });
    });
});
