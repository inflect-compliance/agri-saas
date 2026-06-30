/**
 * RQ3-5 — "from heatmaps to histograms" ratchet.
 *
 * Regression classes guarded:
 *
 *   - the histogram view quietly dropping from the risks page (the
 *     three-view ToggleGroup, the persisted choice, the band-stacked
 *     chart, the appetite line);
 *   - the histogram's cell-collision callout list vanishing from the
 *     risks page;
 *   - the chart losing its a11y contract (generated aria summary,
 *     keyboard-focusable buckets);
 *   - the RiskMatrix/RiskMatrixCell components losing their
 *     collision-marker support (still used by the admin matrix config).
 *
 * NOTE: the risks-page 'heatmap' view (the inline <RiskMatrix> grid) was
 * removed — the page is now a two-view register/histogram toggle. The
 * RiskMatrix *component* lives on for the admin matrix-config surface.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const client = read('src/app/t/[tenantSlug]/(app)/risks/RisksClient.tsx');
const chart = read('src/components/ui/charts/ale-histogram.tsx');
const barrel = read('src/components/ui/charts/index.ts');
const lib = read('src/lib/risk-collisions.ts');

describe('RQ3-5 — the histogram is a peer view', () => {
    test('two views, persisted per tenant (polish #13 pattern)', () => {
        expect(client).toMatch(/useLocalStorage<'register' \| 'histogram'>/);
        expect(client).toMatch(/inflect:risks-view:\$\{tenantSlug\}/);
        expect(client).toMatch(/<ToggleGroup/);
        expect(client).toMatch(/value: 'histogram'/);
        // The 'heatmap' view (inline RiskMatrix grid) was removed — the
        // page must NOT re-introduce it.
        expect(client).not.toMatch(/value: 'heatmap'/);
        expect(client).not.toMatch(/view === 'heatmap'/);
        expect(client).not.toMatch(/<RiskMatrix/);
    });

    test('the chart is the shared primitive, band-stacked, with the appetite line', () => {
        expect(barrel).toMatch(/export \{ AleHistogram, bucketByDecade \}/);
        expect(client).toMatch(/<AleHistogram/);
        expect(client).toMatch(/referenceLine=\{/);
        expect(client).toMatch(/appetiteCap/);
        // Bars stack by the tenant matrix band colours.
        expect(client).toMatch(/resolveBandForScore\(r\.inherentScore, matrixConfig\.bands\)/);
        expect(chart).toMatch(/data-band=\{s\.bandName\}/);
    });

    test('chart a11y: generated summary + keyboard-focusable buckets', () => {
        expect(chart).toMatch(/role="img"/);
        expect(chart).toMatch(/aria-label=\{ariaLabel \?\? summary\}/);
        expect(chart).toMatch(/tallest bucket/);
        expect(chart).toMatch(/tabIndex=\{b\.total > 0 \? 0 : -1\}/);
    });
});

describe('RQ3-5 — cell collisions flag on BOTH views', () => {
    test('the detector is pure and threshold-documented', () => {
        expect(lib).toMatch(/export function detectCellCollisions/);
        expect(lib).toMatch(/export const COLLISION_RATIO_THRESHOLD = 10/);
        expect(lib).not.toMatch(/prisma|RequestContext|@\/lib\/db/);
    });

    test('the risks page computes cell collisions for the histogram callouts', () => {
        expect(client).toMatch(/detectCellCollisions\(/);
    });

    test('the histogram path: the callout list with the drill-down', () => {
        expect(client).toMatch(/risk-collision-callouts/);
        expect(client).toMatch(/Cell collisions/);
        // Clicking a callout drills into the cell's risks, matching
        // the heatmap's onCellClick contract.
        const callout = client.slice(
            client.indexOf('risk-collision-callouts'),
            // The histogram branch ends at the register-view <DataTable>
            // (the old 'view === heatmap' boundary was removed).
            client.indexOf('<DataTable'),
        );
        expect(callout).toMatch(/filterCtx\.set\('score'/);
    });
});
