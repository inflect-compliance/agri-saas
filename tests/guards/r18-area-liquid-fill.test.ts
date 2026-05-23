/**
 * R18-PR6 — MiniAreaChart liquid-fill gloss.
 *
 * The MiniAreaChart (the sparkline behind every KpiCard + the
 * HeroMetric trend chip) already morphs its area `d` from a flat
 * zeroed baseline up to the data shape on mount — the "liquid
 * filling up." PR-6 adds the GLOSS: a subtle vertical sheen
 * painted as an overlay on the area fill so the filled region
 * reads as a glossy liquid surface catching light.
 *
 * Four load-bearing invariants:
 *
 *   1. A `<ChartGloss>` def is rendered, `subtle` intensity.
 *      `subtle` (0.18 peak) — NOT `default` — because sparklines
 *      are tiny + dense; a stronger sheen would wash out the
 *      variant colour at this size.
 *
 *   2. The gloss overlay is a SECOND `<motion.path>` inside the
 *      `<AreaClosed>` render-prop, filled with `url(#<glossId>)`.
 *      Two paths, same render-prop, stacked — the chart-gloss.tsx
 *      two-layer paint.
 *
 *   3. The gloss path's `d` animation TRACKS the colour layer's
 *      — both `initial` from `path(zeroedData)`, both `animate`
 *      to `path(data)`. The sheen "fills up" WITH the liquid; a
 *      static gloss `d` would leave the sheen detached from the
 *      rising fill.
 *
 *   4. The gloss overlay is inert — `aria-hidden` +
 *      `pointerEvents: none`. It carries light, not data, and
 *      must not intercept anything.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/mini-area-chart.tsx'),
    'utf8',
);

describe('R18-PR6 — MiniAreaChart liquid-fill gloss', () => {
    it('imports ChartGloss + chartGlossId from the chart-gloss primitive', () => {
        expect(SRC).toMatch(
            /import\s*\{\s*ChartGloss,\s*chartGlossId,?\s*\}\s*from\s*['"]@\/components\/ui\/charts\/chart-gloss['"]/,
        );
    });

    it('renders a subtle-intensity <ChartGloss> def', () => {
        // subtle, not default — sparklines are tiny + dense.
        expect(SRC).toMatch(
            /<ChartGloss[\s\S]*?direction="vertical"[\s\S]*?intensity="subtle"/,
        );
    });

    it('the gloss overlay is a motion.path filled with the gloss def', () => {
        expect(SRC).toMatch(
            /<motion\.path[\s\S]*?fill=\{`url\(#\$\{chartGlossId\(id\)\}\)`\}/,
        );
    });

    it('the gloss path d-animation tracks the colour layer (fills up WITH the liquid)', () => {
        // Both initial-from zeroedData and animate-to data — the
        // sheen rises with the fill.
        // The motion.path carrying the gloss fill must also carry
        // the zeroedData → data `d` morph. Check the AreaClosed
        // render-prop region holds two `path(zeroedData)` initials.
        const zeroedInits = SRC.match(/initial=\{\{\s*d:\s*path\(zeroedData\)/g);
        expect(zeroedInits).not.toBeNull();
        // One for the colour layer, one for the gloss layer.
        expect(zeroedInits!.length).toBeGreaterThanOrEqual(2);
    });

    it('the gloss overlay is inert — aria-hidden + pointerEvents none', () => {
        expect(SRC).toMatch(
            /fill=\{`url\(#\$\{chartGlossId\(id\)\}\)`\}[\s\S]*?aria-hidden="true"[\s\S]*?pointerEvents:\s*["']none["']/,
        );
    });
});
