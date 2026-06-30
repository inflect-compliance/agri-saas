/**
 * RQ3-9 — Dashboard orchestrator ratchet.
 *
 * Regression classes guarded:
 *
 *   - the dashboard sliding back into a per-widget fetch waterfall
 *     (every widget owning its own `useEffect(fetch(...))` was the
 *     legacy shape; one orchestrated `useTenantSWR` is the new
 *     contract);
 *   - the `score-0-25` ladder coming back to colour the heatmap
 *     (the canonical band resolver is the single source of truth);
 *   - the orchestrator endpoint growing a mutation verb (it is a
 *     pure read fan-out);
 *   - the orchestrator dropping its failure-soft per-slot contract.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const usecase = read('src/app-layer/usecases/risk-dashboard.ts');
const route = read('src/app/api/t/[tenantSlug]/risks/dashboard/route.ts');
const page = read('src/app/t/[tenantSlug]/(app)/risks/dashboard/page.tsx');
const tone = read('src/lib/design/status-tone.ts');

describe('RQ3-9 — the dashboard page consumes the orchestrator (no waterfall)', () => {
    test('the page uses ONE useTenantSWR on /risks/dashboard', () => {
        expect(page).toMatch(/useTenantSWR<DashboardPayload>/);
        expect(page).toMatch(/['"]\/risks\/dashboard['"]/);
    });

    test('the legacy per-widget fetch waterfall is gone', () => {
        // The dashboard previously fired six `fetch(apiUrl('/risks/coherence'))`-
        // style useEffects. None should remain.
        expect(page).not.toMatch(/fetch\(apiUrl\(['"]\/risks\/coherence['"]\)\)/);
        expect(page).not.toMatch(/fetch\(apiUrl\(['"]\/risks\/staleness['"]\)\)/);
        expect(page).not.toMatch(/fetch\(apiUrl\(['"]\/risk-appetite['"]\)\)/);
        expect(page).not.toMatch(/fetch\(apiUrl\(['"]\/risks\/analytics['"]\)\)/);
        expect(page).not.toMatch(/fetch\(apiUrl\(['"]\/risks\/simulate['"]\)\)/);
    });
});

describe('RQ3-9 — the orchestrator stays a pure read fan-out', () => {
    test('the endpoint is GET-only', () => {
        expect(route).toMatch(/export const GET = withApiErrorHandling/);
        for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            expect(route).not.toMatch(new RegExp(`export const ${verb}`));
        }
    });

    test('all seven slots fan out in parallel via Promise.allSettled', () => {
        expect(usecase).toMatch(/Promise\.allSettled/);
        for (const fn of [
            'listRisks',
            'getRiskQuantitativeAnalytics',
            'getRiskCoherence',
            'getRiskStaleness',
            'getAppetiteConfig',
            'getAppetiteStatus',
            'getLatestSimulation',
        ]) {
            expect(usecase).toMatch(new RegExp(fn + '\\('));
        }
    });

    test('failure-soft per slot: each slot maps to null on rejection', () => {
        // The shape is `*Res.status === 'fulfilled' ? *Res.value : null`
        // for every slot EXCEPT the appetite envelope (which collapses
        // on EITHER side failing).
        expect(usecase).toMatch(/risksRes\.status === 'fulfilled' \? .*risksRes\.value.* : \[\]/);
        expect(usecase).toMatch(/analyticsRes\.status === 'fulfilled' \? analyticsRes\.value : null/);
        expect(usecase).toMatch(/coherenceRes\.status === 'fulfilled' \? coherenceRes\.value : null/);
        expect(usecase).toMatch(/stalenessRes\.status === 'fulfilled' \? stalenessRes\.value : null/);
        expect(usecase).toMatch(/simulationRes\.status === 'fulfilled' \? simulationRes\.value : null/);
        // Appetite envelope: both legs must succeed.
        expect(usecase).toMatch(/appetiteConfigRes\.status === 'fulfilled' && appetiteStatusRes\.status === 'fulfilled'/);
    });
});

describe('RQ3-9 — the score-0-25 ladder is dead', () => {
    test('the StatusScale union no longer carries the score-0-25 member', () => {
        // The string literal must not appear in the union declaration.
        // (It may still appear inside doc comments — we look at the
        // `export type StatusScale` declaration only.)
        const match = tone.match(/export type StatusScale =[\s\S]*?;/);
        expect(match).not.toBeNull();
        expect(match![0]).not.toMatch(/'score-0-25'/);
    });

    test('the score-0-25 ladder does not colour the page (heatmap removed)', () => {
        // The hand-built L×I heatmap was removed from the dashboard;
        // neither the canonical band resolver nor the dead score-0-25
        // ladder should be reachable from the page any more.
        expect(page).not.toMatch(/resolveBandForScore/);
        expect(page).not.toMatch(/getStatusTone\(s, ['"]score-0-25['"]\)/);
    });
});
