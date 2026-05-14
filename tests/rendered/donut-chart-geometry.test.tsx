/**
 * DonutChart geometry — rendered regression test.
 *
 * The structural ratchet (`tests/guards/donut-chart-centering.test.ts`)
 * locks the SOURCE shape. This rendered test locks the OUTPUT:
 * it actually mounts `<DonutChart>` and asserts the arcs land
 * inside the SVG viewBox rather than around the (0,0) corner.
 *
 * Why both: the centering bug (visx drops top/left in the
 * children render-prop form) was live for ~weeks while every
 * structural ratchet passed — because the bug wasn't a missing
 * STRING, it was a missing WRAPPER ELEMENT. A rendered test that
 * checks the actual DOM tree is the only thing that catches
 * "the markup compiles but the geometry is wrong."
 */
import { render } from '@testing-library/react';
import DonutChart from '@/components/ui/DonutChart';

describe('DonutChart geometry — arcs land inside the viewBox', () => {
    it('wraps the Pie arcs in a translate(center,center) group', () => {
        const size = 130;
        const { container } = render(
            <DonutChart
                id="test-donut"
                size={size}
                segments={[
                    { label: 'Critical', value: 2, color: '#dc2626' },
                    { label: 'High', value: 1, color: '#f97316' },
                    { label: 'Medium', value: 1, color: '#f59e0b' },
                    { label: 'Low', value: 0, color: '#22c55e' },
                ]}
            />,
        );

        // The centring <g> must exist with the translate transform.
        // size/2 = 65.
        const center = size / 2;
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();

        // Find a <g> whose transform centres the pie. Without it,
        // visx's children render-prop form leaves arcs at origin.
        const groups = Array.from(svg!.querySelectorAll('g'));
        const centringGroup = groups.find(
            (g) =>
                g.getAttribute('transform') ===
                `translate(${center},${center})`,
        );
        expect(centringGroup).toBeDefined();

        // The arc <path> elements must be DESCENDANTS of the
        // centring group — otherwise the transform doesn't move
        // them.
        //
        // R18-PR4 — each segment now renders TWO <path>s: the
        // colour layer (series gradient / hex) + the gloss
        // overlay (`fill="url(#...-gloss)"`). Count the COLOUR
        // paths only — the gloss overlays share their `d` and
        // are aria-hidden light, not geometry.
        const allPaths = Array.from(
            centringGroup!.querySelectorAll('path'),
        );
        const colourPaths = allPaths.filter(
            (p) => !(p.getAttribute('fill') ?? '').includes('-gloss'),
        );
        const glossPaths = allPaths.filter((p) =>
            (p.getAttribute('fill') ?? '').includes('-gloss'),
        );
        // 3 non-zero segments (Low=0 is filtered out by the
        // zero-value guard) → 3 colour paths + 3 gloss overlays.
        expect(colourPaths.length).toBe(3);
        expect(glossPaths.length).toBe(3);
    });

    it('renders one colour arc + one gloss overlay per non-zero segment', () => {
        const { container } = render(
            <DonutChart
                id="test-donut-2"
                size={130}
                segments={[
                    { label: 'A', value: 5, color: '#dc2626' },
                    { label: 'B', value: 0, color: '#f97316' },
                    { label: 'C', value: 3, color: '#f59e0b' },
                ]}
            />,
        );
        // 2 non-zero (A, C); B is filtered. Each gets a colour
        // path + a gloss overlay → 4 total, 2 of each.
        const allPaths = Array.from(
            container.querySelectorAll('svg path'),
        );
        const colourPaths = allPaths.filter(
            (p) => !(p.getAttribute('fill') ?? '').includes('-gloss'),
        );
        expect(colourPaths.length).toBe(2);
        expect(allPaths.length).toBe(4);
    });

    it('arc path coordinates are origin-centred (the visx d3-shape contract)', () => {
        // d3-shape's arc generator emits origin-centred coords —
        // values roughly within ±outerRadius. This is WHY the
        // wrapper <g translate> is load-bearing: the raw path
        // data is centred on (0,0), the <g> moves it to the box
        // centre. If a future change made the paths pre-centred,
        // the wrapper would double-translate — so we lock the
        // origin-centred contract here too.
        const { container } = render(
            <DonutChart
                id="test-donut-3"
                size={130}
                segments={[
                    { label: 'A', value: 1, color: '#dc2626' },
                    { label: 'B', value: 1, color: '#f97316' },
                ]}
            />,
        );
        const firstPath = container.querySelector('svg path[fill="#dc2626"]');
        expect(firstPath).not.toBeNull();
        const d = firstPath!.getAttribute('d') ?? '';
        // First moveto coordinate — should be a small-ish number
        // (within the donut radius ~64), not offset by +65.
        const firstCoord = d.match(/^M\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
        expect(firstCoord).not.toBeNull();
        const [, x, y] = firstCoord!;
        expect(Math.abs(Number(x))).toBeLessThanOrEqual(70);
        expect(Math.abs(Number(y))).toBeLessThanOrEqual(70);
    });
});
