/**
 * R17-PR7 — Clickable KPI tile wiring.
 *
 * PR-6 shipped the DashboardChartContext foundation. PR-7 wires
 * the 6 KPI tiles in the dashboard grid as click consumers:
 * clicking a tile toggles the dashboard's selectedKpi via the
 * context's `toggleSelectedKpi`. PR-8+ will subscribe the chart
 * sections to the same focus to filter their data.
 *
 * Five load-bearing invariants:
 *
 *   1. MetricCard accepts `onClick` + `selected` props. The
 *      chassis becomes a keyboard-accessible button (role,
 *      tabIndex, aria-pressed, Enter/Space handler) ONLY when
 *      `onClick` is provided — never-clickable cards stay
 *      semantically a `<div>`.
 *
 *   2. The chassis exposes the canonical `data-metric-card-
 *      selected` data attribute when selected — the rendered
 *      DOM is the contract surface for E2E selectors and any
 *      future styling layer.
 *
 *   3. KpiCard forwards both new props to MetricCard. No KPI-
 *      level state, no parallel handler — the wiring stays a
 *      pure prop-passthrough so the focus signal lives in one
 *      place.
 *
 *   4. DashboardClient's `<InteractiveKpiGrid>` uses
 *      `useDashboardChartFilter()` and wires all 6 tiles with
 *      `onClick={toggleSelectedKpi('<key>')}` +
 *      `selected={selectedKpi === '<key>'}`. The 6 keys form
 *      the full `DashboardKpiKey` union — adding a 7th KPI
 *      requires updating both this ratchet AND the union, which
 *      keeps the type-level + DOM-level inventory in sync.
 *
 *   5. Visual recipe — selected cards gain a `ring-2 ring-brand-
 *      default` + amped corner glow. Locked here so a future
 *      "let's simplify" PR that strips the ring breaks CI.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const METRIC_CARD = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/MetricCard.tsx'),
    'utf8',
);
const KPI_CARD = fs.readFileSync(
    path.join(ROOT, 'src/components/ui/KpiCard.tsx'),
    'utf8',
);
const DASHBOARD_CLIENT = fs.readFileSync(
    path.join(
        ROOT,
        'src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx',
    ),
    'utf8',
);

describe('R17-PR7 — clickable KPI tile wiring', () => {
    describe('MetricCard chassis', () => {
        it('accepts onClick + selected props', () => {
            expect(METRIC_CARD).toMatch(/onClick\?:\s*\(\)\s*=>\s*void/);
            expect(METRIC_CARD).toMatch(/selected\?\:\s*boolean/);
        });

        it('becomes a keyboard-accessible button only when onClick is set', () => {
            // role/tabIndex/aria-pressed all gated on `clickable` —
            // never-clickable cards stay a plain `<div>` (no
            // implicit button semantics).
            expect(METRIC_CARD).toMatch(
                /const\s+clickable\s*=\s*typeof\s+onClick\s*===\s*['"]function['"]/,
            );
            expect(METRIC_CARD).toMatch(/role=\{clickable\s*\?\s*['"]button['"]\s*:\s*undefined\}/);
            expect(METRIC_CARD).toMatch(/tabIndex=\{clickable\s*\?\s*0\s*:\s*undefined\}/);
            expect(METRIC_CARD).toMatch(/aria-pressed=\{clickable\s*\?\s*selected\s*:\s*undefined\}/);
        });

        it('handles Enter + Space via onKeyDown', () => {
            // Keyboard activation is part of the WAI-ARIA button
            // pattern. Without it, screen reader users can't
            // trigger the action.
            expect(METRIC_CARD).toMatch(
                /e\.key\s*===\s*['"]Enter['"]\s*\|\|\s*e\.key\s*===\s*['"] ['"]/,
            );
        });

        it('exposes `data-metric-card-selected` when selected', () => {
            expect(METRIC_CARD).toMatch(
                /data-metric-card-selected=\{selected\s*\?\s*['"]true['"]\s*:\s*undefined\}/,
            );
        });

        it('selected state carries ring-2 + brand-default + amped glow', () => {
            // The visual recipe — the ring + emphasised border +
            // brighter glow gradient. Locked so a future "simplify"
            // PR that strips the ring breaks CI.
            expect(METRIC_CARD).toMatch(
                /selected\s*&&[\s\S]*?ring-2\s+ring-brand-default[\s\S]*?border-border-emphasis[\s\S]*?before:bg-\[radial-gradient/,
            );
        });
    });

    describe('KpiCard prop passthrough', () => {
        it('threads onClick + selected to MetricCard', () => {
            // KpiCard accepts the new props and forwards them. No
            // local state, no parallel handler.
            expect(KPI_CARD).toMatch(/onClick\?\:\s*\(\)\s*=>\s*void/);
            expect(KPI_CARD).toMatch(/selected\?\:\s*boolean/);
            expect(KPI_CARD).toMatch(
                /<MetricCard[\s\S]*?onClick=\{onClick\}[\s\S]*?selected=\{selected\}/,
            );
        });
    });

    describe('Dashboard wiring (KpiCards covered)', () => {
        it('uses useDashboardChartFilter inside InteractiveKpiGrid', () => {
            expect(DASHBOARD_CLIENT).toMatch(
                /function\s+InteractiveKpiGrid\b[\s\S]*?useDashboardChartFilter\(\)/,
            );
        });

        // The compliance KPIs (coverage / tasks / policies / findings)
        // were removed when those pages left the farm app — only the
        // risk + evidence tiles remain.
        for (const kpi of [
            'risks',
            'evidence',
        ]) {
            it(`wires the "${kpi}" tile with onClick + selected`, () => {
                // Each KpiCard must call click('<key>') AND
                // selected={isSelected('<key>')}. The two helpers
                // resolve to toggle / equality against the context.
                expect(DASHBOARD_CLIENT).toMatch(
                    new RegExp(`onClick=\\{click\\('${kpi}'\\)\\}`),
                );
                expect(DASHBOARD_CLIENT).toMatch(
                    new RegExp(`selected=\\{isSelected\\('${kpi}'\\)\\}`),
                );
            });
        }
    });
});
