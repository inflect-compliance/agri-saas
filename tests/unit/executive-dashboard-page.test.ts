/**
 * Executive Dashboard Page — structural tests.
 *
 * Epic 69 (SWR-First Client-Side Data Fetching) split the dashboard
 * into a thin server shell (`page.tsx`) that fetches once + a
 * `'use client'` component (`DashboardClient.tsx`) that owns all the
 * card composition. The tests below now read BOTH files together so
 * the existing composition / contract assertions still pin the right
 * thing — the layout invariants are about "the dashboard tree" not
 * "the page file".
 *
 * Each section is annotated with which file is being inspected so a
 * future cleanup that re-merges the two (or splits further) updates
 * the right helper.
 */

import * as fs from 'fs';
import * as path from 'path';

const DASHBOARD_DIR = path.resolve(
    __dirname,
    '../../src/app/t/[tenantSlug]/(app)/dashboard',
);
const DASHBOARD_PAGE = path.join(DASHBOARD_DIR, 'page.tsx');
const DASHBOARD_CLIENT = path.join(DASHBOARD_DIR, 'DashboardClient.tsx');

function readPage(): string {
    return fs.readFileSync(DASHBOARD_PAGE, 'utf-8');
}
function readClient(): string {
    return fs.readFileSync(DASHBOARD_CLIENT, 'utf-8');
}
/**
 * Combined view — used by composition / contract assertions that
 * don't care which side of the server/client boundary owns the JSX.
 */
function readAll(): string {
    return `${readPage()}\n${readClient()}`;
}

// ─── Page Structure ────────────────────────────────────────────────

describe('Executive Dashboard Page', () => {
    test('page file exists and is the slim server shell', () => {
        const content = readPage();
        expect(fs.existsSync(DASHBOARD_PAGE)).toBe(true);
        // The shell shouldn't accidentally inline the entire dashboard
        // composition — that defeats the point of the split. Keep it
        // bounded to ~120 lines.
        expect(content.split('\n').length).toBeLessThan(120);
    });

    test('client component exists', () => {
        expect(fs.existsSync(DASHBOARD_CLIENT)).toBe(true);
    });

    test('uses force-dynamic for real-time data', () => {
        expect(readPage()).toContain("dynamic = 'force-dynamic'");
    });

    test('exports async default function (RSC shell)', () => {
        expect(readPage()).toContain('export default async function DashboardPage');
    });

    test('uses getExecutiveDashboard for KPIs', () => {
        expect(readPage()).toContain('getExecutiveDashboard');
    });

    test('fetches trend data via getComplianceTrends', () => {
        expect(readPage()).toContain('getComplianceTrends');
    });

    test('uses tenant context from getTenantCtx', () => {
        expect(readPage()).toContain('getTenantCtx');
    });
});

// ─── Widget Composition ────────────────────────────────────────────

describe('Dashboard Widget Composition', () => {
    test('uses KpiCard component (≥2 instances)', () => {
        const content = readAll();
        expect(content).toContain("from '@/components/ui/KpiCard'");
        const kpiCount = (content.match(/<KpiCard/g) || []).length;
        // Reduced to the farm KPI set (risks + evidence) after the
        // compliance KPIs left the dashboard.
        expect(kpiCount).toBeGreaterThanOrEqual(2);
    });

    // The Risk Distribution donut was removed from the dashboard; the
    // DonutChart component still exists for other surfaces but the
    // dashboard no longer mounts it.
    test('dashboard no longer renders the Risk Distribution DonutChart', () => {
        const content = readAll();
        expect(content).not.toContain('<DonutChart');
    });

    test('uses TrendCard component (Epic 59 — TimeSeriesChart-backed)', () => {
        const content = readAll();
        expect(content).toContain("from '@/components/ui/TrendCard'");
        expect(content).toContain('<TrendCard');
    });

    // The Evidence Status card (the only StatusBreakdown consumer on the
    // dashboard) was removed; the dashboard no longer mounts a breakdown.
    test('dashboard no longer renders the Evidence Status StatusBreakdown', () => {
        const content = readAll();
        expect(content).not.toContain('<StatusBreakdown');
    });

    test('has exactly 2 KPI cards (risks + evidence) for the farm grid', () => {
        const content = readAll();
        const kpiCount = (content.match(/<KpiCard/g) || []).length;
        expect(kpiCount).toBe(2);
    });
});

// ─── Layout Sections ───────────────────────────────────────────────

describe('Dashboard Layout Sections', () => {
    const ids = [
        'kpi-grid',
        'trend-section',
    ];

    test.each(ids)('section id="%s" present', (id) => {
        expect(readAll()).toContain(`id="${id}"`);
    });

    // Risk Distribution, Evidence Status, Compliance Alerts and the
    // Evidence Expiry calendar were removed from the dashboard. Forward-
    // guard their section ids so a re-add is a conscious change.
    const removedIds = [
        'risk-distribution',
        'evidence-status',
        'compliance-alerts',
        'expiry-calendar',
    ];

    test.each(removedIds)('section id="%s" removed', (id) => {
        expect(readAll()).not.toContain(`id="${id}"`);
    });

    test('uses responsive grid layout (lg:grid-cols-2)', () => {
        expect(readAll()).toContain('lg:grid-cols-2');
    });
});

// ─── Server/Client Boundary ────────────────────────────────────────

describe('Dashboard Server/Client Split (Epic 69)', () => {
    test('page.tsx does NOT have "use client" directive (Server Component)', () => {
        const content = readPage();
        expect(content).not.toMatch(/^['"]use client['"]/m);
    });

    test('DashboardClient.tsx DOES have "use client" directive', () => {
        const content = readClient();
        expect(content).toMatch(/^['"]use client['"]/m);
    });

    test('client component reads cache via useTenantSWR', () => {
        const content = readClient();
        expect(content).toContain("from '@/lib/hooks/use-tenant-swr'");
        expect(content).toContain('useTenantSWR');
    });

    test('client component reaches into the typed CACHE_KEYS registry', () => {
        const content = readClient();
        expect(content).toContain("from '@/lib/swr-keys'");
        expect(content).toContain('CACHE_KEYS.dashboard.executive()');
    });

    test('SWR hook is wired with fallbackData (no loading flash on first paint)', () => {
        const content = readClient();
        expect(content).toContain('fallbackData');
    });

    test('page.tsx forwards RecentActivityCard via children (server boundary preserved)', () => {
        const content = readPage();
        expect(content).toContain('<DashboardClient');
        expect(content).toContain('<RecentActivityCard');
    });
});

// ─── Data Contract Compatibility ───────────────────────────────────

describe('Dashboard Data Contracts', () => {
    test('consumes ExecutiveDashboardPayload type', () => {
        expect(readAll()).toContain('ExecutiveDashboardPayload');
    });

    // riskBySeverity backed the Risk Distribution donut, now removed —
    // the dashboard no longer reads those fields (the payload still
    // carries them for other consumers).
    test('no longer reads riskBySeverity fields (Risk Distribution removed)', () => {
        const content = readAll();
        expect(content).not.toContain('riskBySeverity.');
    });

    test('accesses evidenceExpiry fields', () => {
        const content = readAll();
        // Only `.overdue` survives — it feeds the Evidence KPI subtitle
        // and the Next-Best-Action input. The dueSoon7d / current fields
        // left with the removed Evidence Status card.
        expect(content).toContain('evidenceExpiry.overdue');
    });

    test('accesses trend data points for sparklines', () => {
        const content = readAll();
        // The farm dashboard keeps only the risk + evidence trends;
        // the coverage + findings series left with their KPIs.
        expect(content).toContain('risksOpen');
        expect(content).toContain('evidenceOverdue');
    });
});

// ─── Empty State Handling ──────────────────────────────────────────

describe('Dashboard Empty State Handling', () => {
    test('trend section handles no/insufficient data gracefully', () => {
        const content = readAll();
        expect(content).toContain('daysAvailable < 2');
        expect(content).toContain('Trend charts will appear here');
    });

    // Compliance Alerts was removed from the dashboard — no alerts list
    // and no no-alerts empty state remain.
    test('dashboard no longer renders the Compliance Alerts list', () => {
        const content = readAll();
        expect(content).not.toContain('alerts.length === 0');
    });

    test('UI-15: dashboard no longer renders a notifications bell button', () => {
        // The top-bar notifications bell is the single canonical affordance;
        // the dashboard header no longer shows its own on unread > 0.
        expect(readAll()).not.toContain("href={href('/notifications')}");
    });

    test('trend fetch failure degrades gracefully (catch path on the server)', () => {
        // Server file owns the try/catch since it's the one that
        // calls the usecase. Match catch + null fallback explicitly.
        const content = readPage();
        expect(content).toContain('catch');
        expect(content).toMatch(/trends\s*=\s*null/);
    });
});

// ─── Coarse-refresh prohibition (Epic 69 acceptance) ───────────────

describe('Dashboard does not rely on router.refresh()', () => {
    /**
     * Strip block comments + line comments so prose mentions of
     * `router.refresh()` in module docstrings (which describe what
     * the migration moved AWAY from) don't trip the negative
     * assertion. We only want to match real call expressions in
     * executable code.
     */
    function stripComments(src: string): string {
        return src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
    }

    test('neither page.tsx nor DashboardClient.tsx invokes router.refresh()', () => {
        // The Epic 69 acceptance criterion: dashboard freshness
        // flows through SWR cache invalidation, not coarse Next-router
        // refresh. A future PR that introduces `router.refresh()` on
        // this page would defeat the migration.
        const code = stripComments(readPage()) + stripComments(readClient());
        expect(code).not.toMatch(/router\.refresh\s*\(/);
    });
});

// ─── Backward Compatibility ────────────────────────────────────────

describe('Dashboard Backward Compatibility', () => {
    test('loading.tsx still exists', () => {
        expect(fs.existsSync(path.join(DASHBOARD_DIR, 'loading.tsx'))).toBe(true);
    });

    test('RecentActivityCard still exists and is used by page.tsx', () => {
        expect(
            fs.existsSync(path.join(DASHBOARD_DIR, 'RecentActivityCard.tsx')),
        ).toBe(true);
        expect(readPage()).toContain('RecentActivityCard');
    });

    test('OnboardingBanner is still rendered (in client tree)', () => {
        expect(readClient()).toContain('OnboardingBanner');
    });

    test('next-best-action card replaces the legacy quick-actions grid (v2-PR-11)', () => {
        // The 6-button "Quick Actions" grid was retired in v2-PR-11.
        // The dashboard now renders a state-driven recommendation
        // card (`<NextBestActionCard>`) plus a muted "quick add"
        // text-link row below the primary CTA.
        expect(readAll()).toContain('NextBestActionCard');
        expect(readAll()).not.toContain('quickActions');
    });

    test('i18n translations still used (server uses next-intl/server, client uses next-intl)', () => {
        // Server shell no longer needs translations directly; the
        // client owns all i18n strings now.
        expect(readClient()).toContain('useTranslations');
    });
});
