/**
 * Roadmap-16 PR-11 — `<GanttChart>` primitive.
 *
 * R16 Gantt — horizontal stack of rows with gradient bars,
 * curved end-caps, today line, dependency bezier arrows, and
 * left-gutter labels.
 *
 * Six load-bearing invariants:
 *
 *   1. GanttChart + GanttRow exported + barrel re-exported.
 *
 *   2. Renders inside `<ChartFrame>` for state-driven branches.
 *
 *   3. Bars paint via `<ChartLinearGradient direction="horizontal">`
 *      — light-to-dark left-to-right gives the time-direction
 *      cue without a separate legend.
 *
 *   4. Bar `rx={BAR_RADIUS}` (= 4 px) for curved end-caps —
 *      polished, not stamped.
 *
 *   5. Today line as a soft vertical dashed line crossing every
 *      row, in `--bg-attention-emphasis` tone. Renders only when
 *      today falls inside [xMin, xMax].
 *
 *   6. Dependency arrows rendered as bezier curves (M / C path
 *      commands) from upstream bar's end to downstream bar's
 *      start — NOT orthogonal 90° arrows.
 *
 *   7. Series gradient defs render ONE per unique seriesIndex
 *      (deduped via Set). Avoids burning N defs when adjacent
 *      rows share a series.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const GANTT_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/charts/gantt-chart.tsx'),
    'utf8',
);
const BARREL_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/charts/index.ts'),
    'utf8',
);

describe('Roadmap-16 PR-11 — GanttChart primitive', () => {
    describe('exports + barrel', () => {
        it('exports GanttChart function', () => {
            expect(GANTT_SRC).toMatch(/export\s+function\s+GanttChart\s*\(/);
        });

        it('exports GanttRow interface', () => {
            expect(GANTT_SRC).toMatch(/export\s+interface\s+GanttRow\s*\{/);
        });

        it('barrel re-exports GanttChart + GanttRow type', () => {
            expect(BARREL_SRC).toMatch(
                /export\s*\{\s*GanttChart\s*\}\s*from\s*['"]\.\/gantt-chart['"]/,
            );
            expect(BARREL_SRC).toMatch(
                /export\s+type\s*\{\s*GanttRow\s*\}\s*from\s*['"]\.\/gantt-chart['"]/,
            );
        });
    });

    describe('imports', () => {
        it('imports scaleBand + scaleUtc from @visx/scale', () => {
            expect(GANTT_SRC).toMatch(
                /import\s*\{\s*scaleBand[\s\S]*?scaleUtc[\s\S]*?\}\s*from\s*['"]@visx\/scale['"]/,
            );
        });

        it('imports Text from @visx/text (row labels)', () => {
            expect(GANTT_SRC).toMatch(
                /import\s*\{\s*Text\s*\}\s*from\s*['"]@visx\/text['"]/,
            );
        });

        it('imports ChartFrame + ChartLinearGradient + chartGradientId', () => {
            expect(GANTT_SRC).toMatch(/import\s*\{[\s\S]*?ChartFrame[\s\S]*?\}/);
            expect(GANTT_SRC).toMatch(
                /import\s*\{[\s\S]*?ChartLinearGradient[\s\S]*?\}/,
            );
            expect(GANTT_SRC).toMatch(/chartGradientId/);
        });
    });

    describe('GanttRow shape', () => {
        it('declares key + label + start + end + seriesIndex + optional dependencies', () => {
            // Required fields locked here so consumers don't drift.
            expect(GANTT_SRC).toMatch(/key:\s*string/);
            expect(GANTT_SRC).toMatch(/label:\s*string/);
            expect(GANTT_SRC).toMatch(/start:\s*Date/);
            expect(GANTT_SRC).toMatch(/end:\s*Date/);
            expect(GANTT_SRC).toMatch(/seriesIndex:\s*ChartSeriesIndex/);
            expect(GANTT_SRC).toMatch(/dependencies\?\s*:\s*string\[\]/);
        });
    });

    describe('frame + inner component', () => {
        it('wraps in <ChartFrame state={state}>', () => {
            expect(GANTT_SRC).toMatch(/<ChartFrame\s+state=\{state\}/);
        });

        it('lifts the body into GanttChartInner', () => {
            expect(GANTT_SRC).toMatch(/function\s+GanttChartInner\s*\(/);
        });
    });

    describe('layout constants', () => {
        it('BAR_RADIUS = 4 px (curved end-caps)', () => {
            // Same shape as the donut's cornerRadius — polished,
            // not stamped.
            expect(GANTT_SRC).toMatch(/BAR_RADIUS\s*=\s*4/);
        });

        it('ROW_HEIGHT = 28 px (compact stack with breathing room)', () => {
            expect(GANTT_SRC).toMatch(/ROW_HEIGHT\s*=\s*28/);
        });

        it('left padding is wider (120 px) to accommodate row labels', () => {
            expect(GANTT_SRC).toMatch(/left:\s*120/);
        });
    });

    describe('bars + gradient fills', () => {
        it('renders bars as <rect> with rx={BAR_RADIUS} for curved caps', () => {
            expect(GANTT_SRC).toMatch(/<rect[\s\S]*?rx=\{BAR_RADIUS\}/);
        });

        it('bar fill resolves through horizontal ChartLinearGradient', () => {
            expect(GANTT_SRC).toMatch(
                /<ChartLinearGradient[\s\S]*?direction="horizontal"/,
            );
            expect(GANTT_SRC).toMatch(
                /`url\(#\$\{chartGradientId\(chartId,\s*r\.seriesIndex,\s*'linear'\)\}\)`/,
            );
        });

        it('renders one gradient def per unique seriesIndex (dedupe via Set)', () => {
            // Without dedupe, N rows sharing a series would burn N
            // defs. The Set collapses adjacent duplicates.
            expect(GANTT_SRC).toMatch(/new Set\(data\.map/);
        });
    });

    describe('today line', () => {
        it('renders today line as a dashed vertical <line>', () => {
            expect(GANTT_SRC).toMatch(/strokeDasharray="2 3"/);
        });

        it('today line uses --bg-attention-emphasis tone', () => {
            expect(GANTT_SRC).toMatch(
                /stroke="var\(--bg-attention-emphasis\)"/,
            );
        });

        it('today line conditionally rendered when today falls inside [xMin, xMax]', () => {
            // Don't paint a today line if the data is entirely
            // past or entirely future — it'd land at one extreme
            // edge and read as a chart boundary, not as "today".
            expect(GANTT_SRC).toMatch(
                /new Date\(\)\s*>=\s*xMin\s*&&\s*new Date\(\)\s*<=\s*xMax/,
            );
        });
    });

    describe('dependency arrows', () => {
        it('renders dependency arrows as bezier curves (M / C path commands)', () => {
            // Bezier curves (NOT orthogonal lines or arrowheads)
            // — the "lickable chart" vibe. A straight-line arrow
            // reads as engineering diagram.
            expect(GANTT_SRC).toMatch(/`M \$\{up\.x2\}\s+\$\{up\.y\}`/);
            expect(GANTT_SRC).toMatch(/` C \$\{up\.x2\s*\+\s*dx\}/);
        });

        it('arrows are muted (--content-muted resting tone)', () => {
            // Arrows are auxiliary affordances — the bars are
            // the story. Resting tone is muted; PR-12 added a
            // ternary so hovered-chain arrows brighten to the
            // series end-stop. The muted side of the ternary
            // is what we lock here.
            const depBlock = GANTT_SRC.match(
                /data\.flatMap[\s\S]*?return\s*null[\s\S]*?return\s*\([\s\S]*?<path[\s\S]*?\/>/,
            );
            expect(depBlock).not.toBeNull();
            expect(depBlock![0]).toMatch(/'var\(--content-muted\)'/);
            // Resting opacity defaults to 0.5 when nothing is
            // hovered (PR-11 baseline preserved in the PR-12
            // ternary's hoveredKey === null branch).
            expect(depBlock![0]).toMatch(/\?\s*0\.5\s*:/);
        });

        it('arrows are fill="none" + bezier curve only', () => {
            // The arrow is a line, not a filled shape. Without
            // fill="none" the closed-path interior would render.
            expect(GANTT_SRC).toMatch(/<path[\s\S]*?fill="none"/);
        });
    });

    describe('row labels', () => {
        it('renders labels via <Text> from visx/text in the left gutter', () => {
            // JSX prop order isn't enforced. Check each piece
            // independently.
            expect(GANTT_SRC).toMatch(/<Text\b/);
            expect(GANTT_SRC).toMatch(/textAnchor="end"/);
            expect(GANTT_SRC).toMatch(/key=\{`label-\$\{r\.key\}`\}/);
        });
    });
});
