/**
 * Roadmap-16 PR-12 — Lickable Charts capstone bundle.
 *
 * One ratchet walking every R16 deliverable. When this stays
 * green, the entire R16 vocabulary is intact — gradient tokens,
 * gradient primitives, ChartFrame wrapper, motion hooks, all four
 * chart primitives (donut / line / radar / gantt) + their hover
 * affordances.
 *
 * Catches the "drift across PRs" failure mode: each slice-level
 * ratchet stays green while a refactor accidentally drops a
 * load-bearing R16 piece. The bundle fires here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const TOKENS = read('src/styles/tokens.css');
const GRADIENT = read('src/components/ui/charts/chart-gradient.tsx');
const FRAME = read('src/components/ui/charts/chart-frame.tsx');
const MOTION = read('src/components/ui/charts/chart-motion.tsx');
const DONUT = read('src/components/ui/DonutChart.tsx');
const LINE = read('src/components/ui/charts/line-chart.tsx');
const RADAR = read('src/components/ui/charts/radar-chart.tsx');
const GANTT = read('src/components/ui/charts/gantt-chart.tsx');
const BARREL = read('src/components/ui/charts/index.ts');

describe('Roadmap-16 PR-12 — Lickable Charts capstone bundle', () => {
    describe('PR-1 — token foundation', () => {
        it('six series declared on both themes (start + end stops)', () => {
            const dark = TOKENS.match(/:root\s*\{[\s\S]*?\n\}/)![0];
            const light = TOKENS.match(
                /\[data-theme="light"\]\s*\{[\s\S]*?\n\}/,
            )![0];
            for (const i of [1, 2, 3, 4, 5, 6]) {
                expect(dark).toMatch(new RegExp(`--chart-series-${i}-start`));
                expect(dark).toMatch(new RegExp(`--chart-series-${i}-end`));
                expect(light).toMatch(new RegExp(`--chart-series-${i}-start`));
                expect(light).toMatch(new RegExp(`--chart-series-${i}-end`));
            }
        });

        it('motion tokens declared identically on both themes', () => {
            const dark = TOKENS.match(/:root\s*\{[\s\S]*?\n\}/)![0];
            const light = TOKENS.match(
                /\[data-theme="light"\]\s*\{[\s\S]*?\n\}/,
            )![0];
            for (const token of [
                '--chart-hover-pop-distance: 4px',
                '--chart-hover-lift: 2px',
                '--chart-hover-duration: 200ms',
                '--chart-flow-duration: 1.4s',
                '--chart-mount-duration: 600ms',
            ]) {
                expect(dark).toContain(token);
                expect(light).toContain(token);
            }
        });
    });

    describe('PR-2 — gradient primitives', () => {
        it('three gradient primitives + helper + types exported', () => {
            expect(GRADIENT).toMatch(/export\s+function\s+ChartLinearGradient/);
            expect(GRADIENT).toMatch(/export\s+function\s+ChartRadialGradient/);
            expect(GRADIENT).toMatch(/export\s+const\s+ChartFlowGradient\s*=\s*forwardRef/);
            expect(GRADIENT).toMatch(/export\s+function\s+chartGradientId/);
            expect(GRADIENT).toMatch(/export\s+type\s+ChartSeriesIndex/);
        });

        it('FlowGradient uses 3-stop cyclic pattern (start → end → start)', () => {
            const flowBody = GRADIENT.match(
                /function\s+ChartFlowGradient\s*\([\s\S]*?return\s*\(\s*([\s\S]*?)\s*\)\s*;[\s\S]*?\n\}/,
            )?.[1];
            expect(flowBody).not.toBeNull();
            const stops = flowBody!.match(/<stop\b[^/]*\/>/g) ?? [];
            expect(stops.length).toBe(3);
        });
    });

    describe('PR-3 — ChartFrame', () => {
        it('exported + branches on all four state.kind values', () => {
            expect(FRAME).toMatch(/export\s+function\s+ChartFrame/);
            for (const kind of ['loading', 'error', 'empty']) {
                expect(FRAME).toMatch(new RegExp(`state\\.kind\\s*===\\s*['"]${kind}['"]`));
            }
        });

        it('uses @visx/responsive ParentSize for the ready branch', () => {
            expect(FRAME).toMatch(/<ParentSize\b/);
        });
    });

    describe('PR-4 — motion hooks', () => {
        it('useChartHoverPop + useChartFlow both exported', () => {
            expect(MOTION).toMatch(/export\s+function\s+useChartHoverPop/);
            expect(MOTION).toMatch(/export\s+function\s+useChartFlow/);
        });

        it('subtle-intensity constants locked at the user-confirmed values', () => {
            expect(MOTION).toMatch(/CHART_HOVER_POP_DISTANCE\s*=\s*4/);
            expect(MOTION).toMatch(/CHART_HOVER_LIFT\s*=\s*2/);
            expect(MOTION).toMatch(/CHART_HOVER_POINT_SCALE\s*=\s*1\.05/);
        });
    });

    describe('PR-5/6 — DonutChart rebuild + hover', () => {
        it('uses visx Pie + ChartRadialGradient for segment rendering', () => {
            // visx 4: `Pie` is a named root export (deep
            // `@visx/shape/lib/shapes/Pie` subpath removed in the ESM repackage).
            expect(DONUT).toMatch(/import\s*\{\s*Pie\s*\}\s*from\s*['"]@visx\/shape['"]/);
            expect(DONUT).toMatch(/<ChartRadialGradient/);
            expect(DONUT).toMatch(/cornerRadius=\{1\.5\}/);
        });

        it('wires useChartHoverPop + useChartFlow for hover beats', () => {
            expect(DONUT).toMatch(/useChartHoverPop\s*\(/);
            expect(DONUT).toMatch(/useChartFlow\s*\(/);
        });
    });

    describe('PR-7/8 — LineChart + hover', () => {
        it('curveCatmullRom + path-draw animation', () => {
            expect(LINE).toMatch(/curveCatmullRom/);
            expect(LINE).toMatch(/pathLength:\s*0/);
            expect(LINE).toMatch(/pathLength:\s*1/);
        });

        it('bisector + localPoint for hover crosshair', () => {
            expect(LINE).toMatch(/bisector[\s\S]*?\.center/);
            expect(LINE).toMatch(/localPoint/);
        });
    });

    describe('PR-9/10 — RadarChart + hover', () => {
        it('uses ChartRadialGradient for polygon fill + vertex circles', () => {
            expect(RADAR).toMatch(/<ChartRadialGradient/);
            expect(RADAR).toMatch(/<motion\.circle\b/);
        });

        it('hover engages axis + vertex + label as one row', () => {
            expect(RADAR).toMatch(/useChartHoverPop/);
            expect(RADAR).toMatch(/pop\.getPointScale/);
            expect(RADAR).toMatch(/pop\.isPopped/);
        });
    });

    describe('PR-11/12 — GanttChart + hover', () => {
        it('uses scaleBand for rows + ChartLinearGradient for bars', () => {
            expect(GANTT).toMatch(/scaleBand/);
            expect(GANTT).toMatch(/<ChartLinearGradient[\s\S]*?direction="horizontal"/);
        });

        it('bezier dependency arrows (M / C path commands)', () => {
            expect(GANTT).toMatch(/`M \$\{up\.x2\}\s+\$\{up\.y\}`/);
            expect(GANTT).toMatch(/` C \$\{up\.x2/);
        });

        it('hover engages dependency-chain highlight', () => {
            expect(GANTT).toMatch(/dependencyChain/);
            expect(GANTT).toMatch(/<motion\.rect/);
        });
    });

    describe('barrel — every R16 export reachable from @/components/ui/charts', () => {
        const REQUIRED_EXPORTS = [
            'ChartLinearGradient',
            'ChartRadialGradient',
            'ChartFlowGradient',
            'chartGradientId',
            'ChartFrame',
            'useChartHoverPop',
            'useChartFlow',
            'CHART_HOVER_POP_DISTANCE',
            'CHART_HOVER_LIFT',
            'CHART_HOVER_POINT_SCALE',
            'CHART_FLOW_PERIOD_MS',
            'LineChart',
            'RadarChart',
            'GanttChart',
        ];

        for (const name of REQUIRED_EXPORTS) {
            it(`barrel exposes ${name}`, () => {
                expect(BARREL).toContain(name);
            });
        }
    });
});
