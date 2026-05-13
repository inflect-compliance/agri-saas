/**
 * Roadmap-16 PR-12 — GanttChart hover (bar lift + dependency
 * chain highlight).
 *
 * Final hover beats. Hovering a bar:
 *
 *   • Lifts the bar upward by 2 px (translateY, not size change
 *     — preserves the time-axis position).
 *   • Computes the transitive dependency chain (upstream +
 *     downstream, recursively).
 *   • Dims bars outside the chain to 0.4 opacity.
 *   • Brightens arrows inside the chain: stroke shifts from
 *     `--content-muted` to `--chart-series-{N}-end`, opacity
 *     bumps 0.5 → 1.0, strokeWidth 1 → 1.5.
 *
 * The whole project surrounding the hovered bar lights up.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const GANTT_SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/charts/gantt-chart.tsx'),
    'utf8',
);

describe('Roadmap-16 PR-12 — GanttChart hover', () => {
    describe('hover state + chain computation', () => {
        it('tracks hoveredKey via useState<string | null>', () => {
            expect(GANTT_SRC).toMatch(
                /useState<string\s*\|\s*null>\(null\)/,
            );
        });

        it('imports useChartHoverPop + motion + useMemo', () => {
            expect(GANTT_SRC).toMatch(/useChartHoverPop/);
            expect(GANTT_SRC).toMatch(
                /import\s*\{[\s\S]*?motion[\s\S]*?\}\s*from\s*['"]motion\/react['"]/,
            );
            expect(GANTT_SRC).toMatch(
                /import\s*\{[\s\S]*?useMemo[\s\S]*?\}\s*from\s*['"]react['"]/,
            );
        });

        it('computes the transitive dependency chain via memoised BFS', () => {
            // upstream + downstream walk from hoveredKey
            expect(GANTT_SRC).toMatch(/dependencyChain/);
            expect(GANTT_SRC).toMatch(/upstream/);
            expect(GANTT_SRC).toMatch(/downstream/);
            expect(GANTT_SRC).toMatch(/walk\(hoveredKey/);
        });
    });

    describe('bar hover render', () => {
        it('bars are <motion.rect> with animated opacity + translateY', () => {
            expect(GANTT_SRC).toMatch(/<motion\.rect\b/);
            expect(GANTT_SRC).toMatch(
                /opacity:\s*inChain\s*\?\s*1\s*:\s*0\.4/,
            );
            expect(GANTT_SRC).toMatch(
                /translateY:\s*isHovered\s*\?\s*-2\s*:\s*0/,
            );
        });

        it('bars wire onMouseEnter / onMouseLeave / onFocus / onBlur', () => {
            expect(GANTT_SRC).toMatch(/onMouseEnter=\{\s*\(\s*\)\s*=>\s*setHoveredKey\s*\(\s*r\.key\s*\)/);
            expect(GANTT_SRC).toMatch(/onMouseLeave=\{\s*\(\s*\)\s*=>\s*setHoveredKey\s*\(\s*null\s*\)/);
            expect(GANTT_SRC).toMatch(/onFocus=\{\s*\(\s*\)\s*=>\s*setHoveredKey\s*\(\s*r\.key\s*\)/);
            expect(GANTT_SRC).toMatch(/onBlur=\{\s*\(\s*\)\s*=>\s*setHoveredKey\s*\(\s*null\s*\)/);
        });

        it('bars are focusable with tabIndex={0}', () => {
            expect(GANTT_SRC).toMatch(/tabIndex=\{0\}/);
        });
    });

    describe('dependency arrow chain highlight', () => {
        it('arrows in the chain switch stroke to series-end CSS var', () => {
            expect(GANTT_SRC).toMatch(
                /inChain\s*&&\s*hoveredKey\s*!==\s*null[\s\S]*?\?\s*`var\(--chart-series-\$\{r\.seriesIndex\}-end\)`/,
            );
        });

        it('arrows in the chain bump opacity to 1, others fall to 0.2', () => {
            expect(GANTT_SRC).toMatch(
                /hoveredKey\s*===\s*null[\s\S]*?\?\s*0\.5[\s\S]*?:\s*inChain[\s\S]*?\?\s*1[\s\S]*?:\s*0\.2/,
            );
        });

        it('arrow stroke + opacity + width transition in 200ms ease-out', () => {
            expect(GANTT_SRC).toMatch(
                /transition:[\s\S]*?stroke 200ms ease-out[\s\S]*?opacity 200ms ease-out[\s\S]*?stroke-width 200ms ease-out/,
            );
        });
    });
});
