/**
 * R18-PR4 — Donut gloss sheen.
 *
 * First consumer of the R18-PR1 `<ChartGloss>` primitive. The
 * DonutChart now paints the two-layer paint: each segment's
 * colour gradient PLUS a gloss overlay (same `d`, white→
 * transparent ramp) so the ring reads as glass catching light.
 *
 * Five load-bearing invariants:
 *
 *   1. ONE shared `<ChartGloss>` def for the whole donut — every
 *      segment is on the same ring under the same light source,
 *      so they share one vertical sheen. (Contrast: the colour
 *      gradients are PER-series; the gloss is per-DONUT.)
 *
 *   2. The gloss def is `vertical` direction — light from above,
 *      the natural read for a ring lying flat on the card.
 *
 *   3. Each segment renders a SECOND `<path>` with the SAME `d`
 *      as its colour path, filled with `url(#<glossId>)`. Two
 *      paths, same `d`, stacked — the chart-gloss.tsx contract.
 *
 *   4. The gloss overlay path is `pointerEvents="none"` — it sits
 *      ON TOP of the colour layer, so without this it would
 *      steal the hover that belongs to the segment's colour
 *      path's `<g>` wrapper. The hover-pop + flow-gradient
 *      effects depend on the colour layer keeping the pointer.
 *
 *   5. The gloss overlay is `aria-hidden` — it carries no data,
 *      only light. The colour path's `<title>` already names the
 *      segment for assistive tech.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/DonutChart.tsx'),
    'utf8',
);

describe('R18-PR4 — Donut gloss sheen', () => {
    it('imports ChartGloss + chartGlossId from the chart-gloss primitive', () => {
        expect(SRC).toMatch(
            /import\s*\{\s*ChartGloss,\s*chartGlossId,?\s*\}\s*from\s*['"]@\/components\/ui\/charts\/chart-gloss['"]/,
        );
    });

    it('renders ONE shared <ChartGloss> def (per-donut, not per-series)', () => {
        // Exactly one <ChartGloss> in the file. The colour
        // gradients are per-series (a .map); the gloss is one
        // shared def.
        const matches = SRC.match(/<ChartGloss\b/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(1);
        // Not inside a .map() — it's a single def with the
        // donut-level glossId.
        expect(SRC).toMatch(
            /<ChartGloss\s+id=\{chartGlossId\(chartId\)\}/,
        );
    });

    it('the gloss def is vertical (light from above)', () => {
        expect(SRC).toMatch(
            /<ChartGloss[\s\S]*?direction="vertical"/,
        );
    });

    it('each segment paints a gloss overlay <path> with the SAME d, filled with the gloss', () => {
        // The two-layer paint: a second <path d={path}> filled
        // with url(#<glossId>) right after the colour path.
        expect(SRC).toMatch(
            /<path\s+d=\{path\}\s+fill=\{`url\(#\$\{chartGlossId\(chartId\)\}\)`\}/,
        );
    });

    it('the gloss overlay is pointerEvents=none + aria-hidden', () => {
        // pointerEvents=none — the overlay sits on top; without
        // it, it steals the hover from the colour layer's <g>.
        // aria-hidden — the gloss carries light, not data.
        expect(SRC).toMatch(
            /fill=\{`url\(#\$\{chartGlossId\(chartId\)\}\)`\}\s*\n?\s*pointerEvents="none"\s*\n?\s*aria-hidden="true"/,
        );
    });
});
