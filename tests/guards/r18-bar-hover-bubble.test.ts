/**
 * R18-PR9 — bar hover bubble-out.
 *
 * The fourth change to the `<Bars>` primitive: each individual
 * bar springs its `scale` 1 → ~1.06 on hover — it "bubbles out"
 * toward the pointer.
 *
 * Five load-bearing invariants:
 *
 *   1. Per-bar hover state — `hoveredBarKey`, keyed by
 *      `${date}|${seriesId}` so each bar in a STACKED column
 *      bubbles independently (a column-level key would bubble
 *      the whole stack together).
 *
 *   2. Each bar is wrapped in a `<motion.g>` that animates
 *      `scale` between 1 and `BAR_HOVER_SCALE` driven by the
 *      hover state.
 *
 *   3. The hover transition is a `spring` — the overshoot is the
 *      "bubble." A duration/ease would just grow.
 *
 *   4. The hover scale pivots at the bar's CENTRE
 *      (`transformOrigin` = `barCenterX,barCenterY`) — the bar
 *      pops symmetrically toward the viewer. This is DISTINCT
 *      from the PR-8 column settle-bounce, which pivots at the
 *      baseline. Two transforms, two pivots, two motion.g
 *      layers.
 *
 *   5. `onMouseEnter` / `onMouseLeave` set / clear the hover key
 *      on the per-bar `<motion.g>` — the gloss overlay stays
 *      `pointerEvents="none"` so it never steals the hover.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/charts/bars.tsx'),
    'utf8',
);

describe('R18-PR9 — bar hover bubble-out', () => {
    it('tracks per-bar hover state keyed by date|seriesId', () => {
        expect(SRC).toMatch(
            /const\s+\[hoveredBarKey,\s*setHoveredBarKey\]\s*=\s*useState<string\s*\|\s*null>\(null\)/,
        );
        // Keyed by date + series id — independent per stacked bar.
        expect(SRC).toMatch(
            /const\s+barKey\s*=\s*`\$\{d\.date\.toString\(\)\}\|\$\{b\.id\}`/,
        );
    });

    it('wraps each bar in a motion.g that animates scale on hover', () => {
        expect(SRC).toMatch(
            /<motion\.g[\s\S]*?animate=\{\{\s*scale:\s*isHovered\s*\?\s*BAR_HOVER_SCALE\s*:\s*1\s*\}\}/,
        );
    });

    it('the hover transition is a spring (overshoot = the bubble)', () => {
        expect(SRC).toMatch(
            /transition=\{\{[\s\S]*?type:\s*["']spring["'][\s\S]*?stiffness:\s*\d+[\s\S]*?damping:\s*\d+/,
        );
    });

    it('the hover scale pivots at the bar CENTRE (not the baseline)', () => {
        // barCenterX / barCenterY — distinct from PR-8's
        // baseline-pivoted column settle-bounce.
        expect(SRC).toMatch(
            /const\s+barCenterY\s*=\s*barTop\s*\+\s*b\.height\s*\/\s*2/,
        );
        expect(SRC).toMatch(
            /transformOrigin:\s*`\$\{barCenterX\}px\s+\$\{barCenterY\}px`/,
        );
    });

    it('onMouseEnter / onMouseLeave drive the hover key on the per-bar motion.g', () => {
        expect(SRC).toMatch(
            /onMouseEnter=\{\(\)\s*=>\s*setHoveredBarKey\(barKey\)\}/,
        );
        expect(SRC).toMatch(
            /onMouseLeave=\{\(\)\s*=>\s*setHoveredBarKey\(null\)\}/,
        );
        // The gloss overlay stays inert so it can't steal the hover.
        expect(SRC).toMatch(
            /fill=\{`url\(#\$\{chartGlossId\(chartId\)\}\)`\}[\s\S]*?pointerEvents="none"/,
        );
    });
});
