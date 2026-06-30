/**
 * Risk Heatmap & Evidence Expiry Calendar Widget Tests
 *
 * Structural tests verifying:
 *   1. Component exports & structure
 *   2. Empty state handling
 *   3. Color/urgency logic correctness
 *   4. Date formatting safety
 *   5. Backend DTO additions
 *   6. Dashboard integration
 */

import * as fs from 'fs';
import * as path from 'path';

const UI_DIR = path.resolve(__dirname, '../../src/components/ui');
const REPO_FILE = path.resolve(__dirname, '../../src/app-layer/repositories/DashboardRepository.ts');
const USECASE_FILE = path.resolve(__dirname, '../../src/app-layer/usecases/dashboard.ts');
const DASHBOARD_PAGE_FILE = path.resolve(
    __dirname,
    '../../src/app/t/[tenantSlug]/(app)/dashboard/page.tsx',
);
// Epic 69 split the dashboard into a thin server shell + a
// `'use client'` component that owns the card composition. The
// page imports moved with the JSX, so structural assertions read
// both files as a single combined surface.
const DASHBOARD_CLIENT_FILE = path.resolve(
    __dirname,
    '../../src/app/t/[tenantSlug]/(app)/dashboard/DashboardClient.tsx',
);

// ─── Widget Exports ────────────────────────────────────────────────

describe('RiskHeatmap Widget', () => {
    const content = fs.readFileSync(path.join(UI_DIR, 'RiskHeatmap.tsx'), 'utf-8');

    test('file exists and is substantial', () => {
        expect(content.length).toBeGreaterThan(1000);
    });

    test('exports default component and HeatmapCell type', () => {
        expect(content).toContain('export default function RiskHeatmap');
        expect(content).toContain('export interface HeatmapCell');
    });

    test('renders a 5×5 grid by default', () => {
        expect(content).toContain('scale = 5');
        // Should iterate rows and cols
        expect(content).toContain('Array.from({ length: scale }');
    });

    test('handles empty state (zero risks)', () => {
        expect(content).toContain('totalRisks === 0');
        expect(content).toContain('No risks registered yet');
    });

    test('color-codes by risk score via R21-PR-C useHeatScale', () => {
        // R21-PR-C replaced the bespoke score-bucket palette
        // (bg-red-500 / bg-orange-500 / bg-amber-500 / bg-emerald-500)
        // with a continuous OKLAB ramp driven by `useHeatScale`
        // from the chart-series 4 (pink) token family. The cells
        // colour-map via `heat.colorFor(score)` where score is
        // likelihood × impact.
        expect(content).toContain('useHeatScale');
        expect(content).toContain('heat.colorFor(score)');
        expect(content).toContain('likelihood * impact');
    });

    test('uses likelihood × impact lookup', () => {
        expect(content).toContain('likelihood * impact');
        expect(content).toContain('lookup.get');
        expect(content).toContain('new Map');
    });

    test('has axis labels (Likelihood + Impact)', () => {
        expect(content).toContain('Likelihood');
        expect(content).toContain('Impact');
    });

    test('has a gradient legend (R21-PR-C ChartLegend)', () => {
        // R21-PR-C replaced the discrete Low/Medium/High/Critical
        // 4-swatch legend with a continuous-ramp `<ChartLegend
        // variant="gradient">` painted from the same tokens the
        // cells consume.
        expect(content).toContain('ChartLegend');
        expect(content).toContain('variant="gradient"');
        expect(content).toContain('heatScale={heat}');
    });

    test('supports className and id props', () => {
        expect(content).toContain("className?: string");
        expect(content).toContain("id?: string");
    });

    test('uses the canonical Card primitive surface', () => {
        // Roadmap-5 PR-1 — the glass-card literal moved into the
        // Card primitive. Components now compose cardVariants()
        // (or render `<Card>`) instead of referencing the legacy
        // class string directly.
        expect(content).toMatch(/cardVariants\(|<Card\b/);
    });
});

describe('ExpiryCalendar Widget', () => {
    const content = fs.readFileSync(path.join(UI_DIR, 'ExpiryCalendar.tsx'), 'utf-8');

    test('file exists and is substantial', () => {
        expect(content.length).toBeGreaterThan(1000);
    });

    test('exports default component and ExpiryItem type', () => {
        expect(content).toContain('export default function ExpiryCalendar');
        expect(content).toContain('export interface ExpiryItem');
    });

    test('handles empty state (no items)', () => {
        expect(content).toContain('items.length === 0');
        expect(content).toContain('No upcoming evidence expirations');
    });

    test('groups by urgency levels', () => {
        expect(content).toContain("'overdue'");
        expect(content).toContain("'urgent'");
        expect(content).toContain("'upcoming'");
        expect(content).toContain("'normal'");
    });

    test('urgency color coding', () => {
        expect(content).toContain('text-red-400');
        expect(content).toContain('text-amber-400');
        expect(content).toContain('text-yellow-400');
    });

    test('formats days until correctly', () => {
        expect(content).toContain("'Today'");
        expect(content).toContain("'Tomorrow'");
        expect(content).toContain('overdue');
    });

    test('date formatting uses UTC to avoid timezone shifts', () => {
        // Epic 58 — the inline UTC formatter was replaced by the
        // canonical `formatDateCompact` helper, which declares
        // `timeZone: 'UTC'` on its shared `Intl.DateTimeFormat` in
        // `src/lib/format-date.ts`. The UTC guarantee still holds;
        // the call site just delegates instead of hardcoding the
        // option bag.
        expect(content).toContain('formatDateCompact');
    });

    test('truncates long titles', () => {
        expect(content).toContain('truncate');
    });

    test('has scrollable overflow for long lists', () => {
        expect(content).toContain('overflow-y-auto');
    });

    test('supports className and id props', () => {
        expect(content).toContain("className?: string");
        expect(content).toContain("id?: string");
    });

    test('uses the canonical Card primitive surface', () => {
        // Roadmap-5 PR-1 — the glass-card literal moved into the
        // Card primitive. Components now compose cardVariants()
        // (or render `<Card>`) instead of referencing the legacy
        // class string directly.
        expect(content).toMatch(/cardVariants\(|<Card\b/);
    });
});

// ─── Backend DTO & Query Additions ──────────────────────────────────

describe('Dashboard DTO Extensions', () => {
    const repoContent = fs.readFileSync(REPO_FILE, 'utf-8');

    test('EvidenceExpiryItem interface exported', () => {
        expect(repoContent).toContain('export interface EvidenceExpiryItem');
        expect(repoContent).toContain('nextReviewDate: string');
        expect(repoContent).toContain('daysUntil: number');
    });

    test('ExecutiveDashboardPayload includes upcomingExpirations', () => {
        expect(repoContent).toContain('upcomingExpirations: EvidenceExpiryItem[]');
    });

    test('getUpcomingExpirations uses findMany with date filter', () => {
        expect(repoContent).toContain('getUpcomingExpirations');
        expect(repoContent).toContain('nextReviewDate');
        expect(repoContent).toContain('take: 20');
    });
});

describe('Dashboard Usecase Updates', () => {
    const usecaseContent = fs.readFileSync(USECASE_FILE, 'utf-8');

    test('fetches upcomingExpirations in parallel', () => {
        expect(usecaseContent).toContain('DashboardRepository.getUpcomingExpirations');
    });

    test('returns upcomingExpirations in payload', () => {
        expect(usecaseContent).toContain('upcomingExpirations,');
    });
});

// ─── Dashboard Page Integration ─────────────────────────────────────

describe('Dashboard Page Integration', () => {
    const content =
        fs.readFileSync(DASHBOARD_PAGE_FILE, 'utf-8') +
        '\n' +
        fs.readFileSync(DASHBOARD_CLIENT_FILE, 'utf-8');

    // The risk-matrix heatmap card was removed from the dashboard UI, and
    // the server `riskHeatmap` payload it consumed was dropped too (the DTO +
    // usecase no longer compute it). The Evidence ExpiryCalendar remains
    // (now full-width).
    test('the dashboard no longer renders the RiskMatrix heatmap', () => {
        expect(content).not.toContain("from '@/components/ui/RiskMatrix'");
        expect(content).not.toContain('<RiskMatrix');
        expect(content).not.toContain('id="risk-heatmap"');
        // …and no longer fetches the matrix config for the (removed) card.
        expect(content).not.toContain('getRiskMatrixConfig');
    });

    test('imports ExpiryCalendar', () => {
        expect(content).toContain("from '@/components/ui/ExpiryCalendar'");
    });

    test('renders ExpiryCalendar with id', () => {
        expect(content).toContain('<ExpiryCalendar');
        expect(content).toContain('id="expiry-calendar"');
    });

    test('passes exec.upcomingExpirations to ExpiryCalendar', () => {
        expect(content).toContain('items={exec.upcomingExpirations}');
    });
});

// ─── Urgency Logic Unit Tests ───────────────────────────────────────

describe('ExpiryCalendar Urgency Logic', () => {
    const content = fs.readFileSync(path.join(UI_DIR, 'ExpiryCalendar.tsx'), 'utf-8');

    test('overdue threshold: daysUntil < 0', () => {
        expect(content).toContain('daysUntil < 0');
    });

    test('urgent threshold: daysUntil <= 7', () => {
        expect(content).toContain('daysUntil <= 7');
    });

    test('upcoming threshold: daysUntil <= 14', () => {
        expect(content).toContain('daysUntil <= 14');
    });

    test('ordered groups: overdue first, normal last', () => {
        const overdueIdx = content.indexOf("'overdue'");
        const normalIdx = content.lastIndexOf("'normal'");
        expect(overdueIdx).toBeLessThan(normalIdx);
    });
});

// ─── Risk Heatmap Score Logic Unit Tests ─────────────────────────────

describe('RiskHeatmap Score Logic (post R21-PR-C heatmap rebuild)', () => {
    const content = fs.readFileSync(path.join(UI_DIR, 'RiskHeatmap.tsx'), 'utf-8');

    // R21-PR-C replaced the discrete score-bucket thresholds with
    // a continuous OKLAB heat scale over the [1, scale²] domain.
    // The Low/Medium/High/Critical labels + getScoreLabel function
    // are gone; the colour gradation IS the severity readout, and
    // the tooltip shows the raw score plus count.

    test('continuous score domain spans [1, scoreMax]', () => {
        expect(content).toContain('scoreMax = scale * scale');
        expect(content).toContain('domain: [1, scoreMax]');
    });

    test('cell colour interpolates via the heat scale, not a bucket lookup', () => {
        expect(content).toContain('heat.colorFor(score)');
    });

    test('cell tooltips include likelihood × impact + count', () => {
        // The score + cell count are surfaced in the tooltip
        // string. Severity buckets aren't a separate label any
        // more — the colour communicates severity directly.
        expect(content).toContain('L${likelihood} × I${impact} = ${score}');
        expect(content).toContain('${count} risk');
    });
});
