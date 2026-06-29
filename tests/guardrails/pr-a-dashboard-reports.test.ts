/**
 * PR-A — Dashboard balance + Reports card ratchet.
 *
 *   1. The Evidence Status surface is now a single `<Card>` with a
 *      `<Heading>` + a non-wrapping `<StatusBreakdown>` + an
 *      optional trend mini-chart, matching the Compliance Alerts
 *      card's visual weight. The Card carries the canonical
 *      `id="evidence-status"` E2E selector preserved from the
 *      pre-PR-A composition.
 *
 *   2. The Control Coverage `<ProgressCard>` accepts a `trend`
 *      prop and the dashboard threads the coverage-over-time
 *      series into it.
 *
 *   3. `<ProgressCard>` itself renders the trend slot below the
 *      segment legend (gated on `trend.points.length > 0`) and
 *      uses the shared `<TrendCard>` primitive — no hand-rolled
 *      sparkline.
 *
 *   4. The Reports SoA tab table card uses the canonical
 *      `cardVariants()` density (was `density: 'none'`) so the
 *      table presentation matches the Controls / Risks / Assets
 *      list pages.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PR-A — dashboard balance + reports card', () => {
    describe('ProgressCard trend slot', () => {
        const src = read('src/components/ui/ProgressCard.tsx');

        it('declares the ProgressCardTrend prop shape', () => {
            expect(src).toMatch(/export interface ProgressCardTrend/);
            expect(src).toMatch(
                /points:\s*ReadonlyArray<\{\s*date:\s*Date;\s*value:\s*number\s*\}>/,
            );
            expect(src).toMatch(/colorClassName:\s*string/);
        });

        it('renders the trend via the shared TrendCard primitive', () => {
            // The trend mini-chart MUST go through TrendCard — a
            // hand-rolled svg+polyline would diverge visually from
            // the Trend section below. Anchor on both the import
            // and the JSX usage in the trend branch.
            expect(src).toMatch(
                /import\s*\{\s*TrendCard\s*\}\s*from\s*['"]@\/components\/ui\/TrendCard['"]/,
            );
            // The JSX usage sits inside the `trend &&
            // trend.points.length > 0` branch.
            expect(src).toMatch(
                /trend &&\s*trend\.points\.length > 0[\s\S]{0,800}<TrendCard\b/,
            );
            // Stable testid lets the dashboard ratchet locate the
            // trend slot without coupling to internal structure.
            expect(src).toMatch(/data-testid="progress-card-trend"/);
        });
    });

    describe('Dashboard adoption', () => {
        const src = read(
            'src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx',
        );

        // The Control Coverage ProgressCard was removed when the controls
        // page left the farm app, so the dashboard no longer threads a
        // coverage trend. The ProgressCard primitive's own trend-slot
        // contract is still covered above.

        it('Evidence Status renders one Card containing the breakdown', () => {
            // The card identity is preserved (canonical
            // `id="evidence-status"` matches the unit-test
            // `Dashboard Layout Sections` probe).
            expect(src).toMatch(/<Card id="evidence-status"/);
            // Heading + non-wrapping StatusBreakdown live inside it.
            expect(src).toMatch(
                /<Card id="evidence-status"[\s\S]{0,2000}<Heading[\s\S]{0,400}Evidence Status[\s\S]{0,2000}<StatusBreakdown/,
            );
        });

        it('Evidence Status surfaces a percent-current readout', () => {
            expect(src).toMatch(/data-testid="evidence-status-current-percent"/);
        });

        it('Evidence Status mounts the evidence-overdue trend mini-chart', () => {
            expect(src).toMatch(/data-testid="evidence-status-trend"/);
            // The trend pulls from the same trendBundle as the
            // existing Trend section below — no parallel hand-
            // fetched series.
            expect(src).toMatch(/trendBundle\?\.evidence/);
        });

        it('uses the non-wrapping status-breakdown primitive', () => {
            // The default-export `@/components/ui/StatusBreakdown`
            // wraps itself in `cardVariants()`. The non-wrapping
            // lowercase `status-breakdown` is the right primitive
            // when we host the breakdown inside our own Card.
            expect(src).toMatch(
                /from\s*['"]@\/components\/ui\/status-breakdown['"]/,
            );
        });
    });

    describe('Reports SoA table card', () => {
        const src = read(
            'src/app/t/[tenantSlug]/(app)/reports/soa/SoAClient.tsx',
        );

        it('uses default cardVariants density (no `density: "none"`)', () => {
            // Anchor the assertion to the SoA-table card-card
            // div via the new testid. The pre-PR-A wrapper passed
            // `density: 'none'`; matching the Controls/Risks list-
            // page DataTable card means the card-default density.
            //
            // The "soa-table-card" anchor + the `cardVariants()`
            // call site appear inside the same JSX expression. A
            // future refactor that forgets the default density will
            // re-introduce `cardVariants({ density: 'none' })` here
            // and trip the second assertion.
            const cardIdx = src.indexOf('data-testid="soa-table-card"');
            expect(cardIdx).toBeGreaterThan(0);
            // The preceding ~150 chars are the wrapper open tag.
            const wrapper = src.slice(Math.max(0, cardIdx - 200), cardIdx + 80);
            expect(wrapper).toMatch(/cardVariants\(\)/);
            expect(wrapper).not.toMatch(/density:\s*['"]none['"]/);
        });
    });
});
