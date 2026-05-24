/**
 * Epic 69 — pilot SWR migration of the executive dashboard.
 *
 * Pattern (the canonical Next.js + SWR shape, applied here for the
 * first time in the codebase — future page migrations follow this
 * exact recipe):
 *
 *   server `page.tsx` ──fetches once──▶ initialExec / initialTrends
 *                                       │
 *                                       ▼
 *                       <DashboardClient initialExec=… initialTrends=…>
 *                                       │
 *                                       ▼
 *                       useTenantSWR(CACHE_KEYS.dashboard.executive(),
 *                                    { fallbackData: initialExec })
 *
 * What this gets us that the all-server version did NOT:
 *
 *   - **Background revalidation on focus / reconnect.** The user
 *     leaves the tab, comes back, the KPI numbers are fresh — no
 *     full-page reload, no router.refresh(). The Epic 69 hook's
 *     `keepPreviousData: true` default means the cards never
 *     flash to a skeleton during the background fetch.
 *
 *   - **Programmatic invalidation by mutation sites.** Any future
 *     `useTenantMutation({ key, invalidate: [
 *         CACHE_KEYS.dashboard.executive(),
 *     ] })` call elsewhere in the app (a control status flip, a
 *     risk close, an evidence upload) will trigger a background
 *     refetch of just this card stack — the right granularity,
 *     no coarse `router.refresh()` needed.
 *
 *   - **Zero loading flash on first paint.** The server still
 *     fetches and serialises the initial payload, so SWR's
 *     `fallbackData` makes `data` defined synchronously on mount.
 *     The page renders identical bytes to the pre-migration
 *     version on cold visit.
 *
 * Why this is a "pilot":
 *
 *   - Only the executive payload + the trend payload move into
 *     SWR cache. RecentActivityCard stays a server component
 *     (passed as `children` from `page.tsx`) because there's no
 *     API route for it yet. Migrating it is a self-contained
 *     follow-up.
 *
 *   - The pattern documented here is the template for migrating
 *     /controls, /risks, /evidence list pages next. The four
 *     moving parts (server fetch → fallback → useTenantSWR →
 *     children for sub-trees that stay server-rendered) are
 *     the same on every page.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
    ShieldCheck,
    AlertTriangle,
    Paperclip,
    CheckCircle2,
    Bug,
    Bell,
    FileText,
    TrendingUp,
} from 'lucide-react';

import OnboardingBanner from '@/components/onboarding/OnboardingBanner';
import { Skeleton } from '@/components/ui/skeleton';
import KpiCard from '@/components/ui/KpiCard';
import ProgressCard from '@/components/ui/ProgressCard';
import DonutChart from '@/components/ui/DonutChart';
import { TrendCard } from '@/components/ui/TrendCard';
// PR-A — switched from the auto-wrapping default StatusBreakdown
// to the non-wrapping primitive so the Evidence Status card can
// host the breakdown + a trend mini-chart inside ONE Card without
// nested-cards (the legacy default-export wraps itself in
// cardVariants()).
import { StatusBreakdown } from '@/components/ui/status-breakdown';
import { RiskMatrix } from '@/components/ui/RiskMatrix';
import ExpiryCalendar from '@/components/ui/ExpiryCalendar';
import { StatusBadge } from '@/components/ui/status-badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@dub/utils';

import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HeroMetric } from '@/components/ui/HeroMetric';
import { NextBestActionCard } from '@/components/ui/NextBestActionCard';
import {
    DashboardChartProvider,
    useDashboardChartFilter,
    type DashboardKpiKey,
} from './DashboardChartContext';

import type { ExecutiveDashboardPayload } from '@/app-layer/repositories/DashboardRepository';
import type { TrendPayload } from '@/app-layer/usecases/compliance-trends';
import type { RiskMatrixConfigShape } from '@/lib/risk-matrix/types';
import { Heading } from '@/components/ui/typography';
import { Card, cardVariants } from '@/components/ui/card';

// ─── KPI trend bundle ─────────────────────────────────────────────────

type KpiTrendBundle = {
    coverage?: ReadonlyArray<{ date: Date; value: number }>;
    risks?: ReadonlyArray<{ date: Date; value: number }>;
    evidence?: ReadonlyArray<{ date: Date; value: number }>;
    findings?: ReadonlyArray<{ date: Date; value: number }>;
};

function deriveTrendBundle(
    trends: TrendPayload | null | undefined,
): KpiTrendBundle | undefined {
    // Defensive: a trend snapshot for a fresh tenant may have
    // `daysAvailable >= 2` from the snapshot machinery while
    // `dataPoints` is still empty mid-rollout (or missing entirely
    // if the upstream returns an unexpected shape). Guard both.
    if (!trends || trends.daysAvailable < 2 || !trends.dataPoints?.length) {
        return undefined;
    }
    return {
        coverage: trends.dataPoints.map((d) => ({
            date: new Date(d.date),
            value: d.controlCoveragePercent,
        })),
        risks: trends.dataPoints.map((d) => ({
            date: new Date(d.date),
            value: d.risksOpen,
        })),
        evidence: trends.dataPoints.map((d) => ({
            date: new Date(d.date),
            value: d.evidenceOverdue,
        })),
        findings: trends.dataPoints.map((d) => ({
            date: new Date(d.date),
            value: d.findingsOpen,
        })),
    };
}

// ─── Component ────────────────────────────────────────────────────────

interface DashboardClientProps {
    initialExec: ExecutiveDashboardPayload;
    initialTrends: TrendPayload | null;
    matrixConfig: RiskMatrixConfigShape;
    /**
     * RecentActivityCard remains a Server Component (no API route
     * yet) and is rendered into the dashboard tree by the parent
     * server page. Passing it through `children` preserves the
     * server boundary.
     */
    children?: React.ReactNode;
}

export default function DashboardClient({
    initialExec,
    initialTrends,
    matrixConfig,
    children,
}: DashboardClientProps) {
    const t = useTranslations('dashboard');
    const href = useTenantHref();

    // Primary KPI / coverage / risk-distribution payload. The
    // `fallbackData` makes `data` defined synchronously on mount —
    // there is no loading state on first render. Background
    // revalidation kicks in on focus / reconnect.
    const { data: execFromCache } = useTenantSWR<ExecutiveDashboardPayload>(
        CACHE_KEYS.dashboard.executive(),
        { fallbackData: initialExec },
    );

    // Trend payload — same hybrid pattern. The 30-day query window
    // is fixed across the dashboard's lifetime, so it's safe to bake
    // into the cache key.
    const { data: trends } = useTenantSWR<TrendPayload | null>(
        `${CACHE_KEYS.dashboard.trends()}?days=30`,
        // Pre-Epic-69 the server-fetched trend was passed as
        // `null` when the snapshot history was too short to plot;
        // the type allows that and the SWR cache treats null as a
        // legitimate value (not "missing").
        { fallbackData: initialTrends },
    );

    // SWR's contract is `data | undefined`; the fallback narrows it
    // for first paint. The `??` keeps TS happy AND defends against
    // the (theoretical) case where SWR clears the cache out from
    // under us. Local name is `exec` to match the existing structural
    // pins (E2E selectors + dashboard-page test reads `cells={exec.X}`,
    // `items={exec.X}`).
    const exec = execFromCache ?? initialExec;
    const trendBundle = deriveTrendBundle(trends ?? initialTrends ?? undefined);

    const headerActions = exec.stats.unreadNotifications > 0 ? (
        <Link
            href={href('/notifications')}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
            <Bell className="w-4 h-4" aria-hidden="true" />
            <StatusBadge variant="error" icon={null} size="sm">
                {exec.stats.unreadNotifications}
            </StatusBadge>
        </Link>
    ) : undefined;

    // v2-PR-10 — masthead hero metric. Single 72px control-coverage
    // figure as the user's first verdict on the page. Trend delta
    // resolved from the 30-day coverage trend bundle (last point
    // minus the previous point — same calculation the per-KPI trend
    // chip uses, just expressed as a 7-day window).
    const coverageTrend = trendBundle?.coverage;
    const coverageDelta = (() => {
        if (!coverageTrend || coverageTrend.length < 2) return null;
        const last = coverageTrend[coverageTrend.length - 1];
        const prev = coverageTrend[coverageTrend.length - 2];
        if (!last || !prev) return null;
        return last.value - prev.value;
    })();

    return (
        // R17-PR6 — dashboard chart-filter coordination. The provider
        // holds the currently-selected KPI (or null). PR-7 wires the
        // KpiCards as click consumers; PR-8+ wire the chart sections
        // to subscribe + filter their data. Today this provider is a
        // pass-through — the dashboard renders identically to pre-R17
        // until the consumers light up.
        <DashboardChartProvider>
        <DashboardLayout
            header={{
                title: t('title'),
                description: t('subtitle'),
                actions: headerActions,
            }}
        >
            <OnboardingBanner />

            {/* ─── Masthead — Hero readiness metric (v2-PR-10) ─── */}
            <HeroMetric
                eyebrow={t('controls')}
                value={exec.controlCoverage.coveragePercent}
                format="percent"
                description={`${exec.controlCoverage.implemented} of ${exec.controlCoverage.applicable} controls implemented`}
                delta={coverageDelta}
                deltaPolarity="up-good"
                deltaLabel="vs prev"
                action={{
                    label: t('viewAllClauses'),
                    href: href('/clauses'),
                    'data-testid': 'hero-action-clauses',
                }}
                data-testid="dashboard-hero"
            />

            {/* ─── KPI Grid (6 cards) — R17-PR7: each tile is now a
                 keyboard-accessible button wired into the dashboard
                 chart-filter context. Clicking a tile toggles the
                 dashboard's selectedKpi; PR-8+ will subscribe the
                 charts to that focus and re-render their data. ─── */}
            <InteractiveKpiGrid exec={exec} trendBundle={trendBundle} t={t} />

            {/* ─── Control Coverage + Risk Distribution ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <ChartFocusWrapper kpiKey="coverage">
                    <ProgressCard
                        id="control-coverage"
                        label="Control Coverage"
                        value={exec.controlCoverage.implemented}
                        max={exec.controlCoverage.applicable || 1}
                        segments={[
                            {
                                label: 'Implemented',
                                value: exec.controlCoverage.implemented,
                                color: 'bg-bg-success-emphasis',
                            },
                            {
                                label: 'In Progress',
                                value: exec.controlCoverage.inProgress,
                                color: 'bg-bg-warning-emphasis',
                            },
                            {
                                label: 'Not Started',
                                value: exec.controlCoverage.notStarted,
                                color: 'bg-border-emphasis',
                            },
                        ]}
                        // PR-A — coverage-over-time mini chart. Picks the
                        // single most useful KPI for this card (the
                        // metric the card already headlines) and shows
                        // its trajectory inside the same surface.
                        trend={
                            trendBundle?.coverage &&
                            trendBundle.coverage.length > 1
                                ? {
                                      label: 'Coverage (trend)',
                                      points: trendBundle.coverage,
                                      colorClassName: 'text-content-success',
                                      format: '%',
                                  }
                                : undefined
                        }
                        footer={
                            <Link
                                href={href('/clauses')}
                                className="text-[var(--brand-emphasis)] hover:text-[var(--brand-muted)]"
                            >
                                {t('viewAllClauses')}
                            </Link>
                        }
                    />
                </ChartFocusWrapper>
                <RiskDistributionSection exec={exec} />
            </div>

            {/* ─── Evidence Status + Compliance Alerts ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <ChartFocusWrapper kpiKey="evidence">
                    <EvidenceStatusSection
                        exec={exec}
                        trendBundle={trendBundle}
                    />
                </ChartFocusWrapper>
                <ComplianceAlerts exec={exec} t={t} />
            </div>

            {/* ─── Risk Heatmap + Evidence Expiry ─── */}
            {/* B1 — heatmap subscribes to risks KPI; expiry calendar
                subscribes to evidence KPI. Pre-B1 these were not in
                the focus graph at all, so clicking the risks card
                only lit RiskDistribution (not the heatmap), and
                clicking the evidence card only lit EvidenceStatus
                (not the expiry calendar). Both compose with
                <ChartFocusWrapper> the same way the trend cards do. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <ChartFocusWrapper kpiKey="risks">
                    <RiskMatrix
                        id="risk-heatmap"
                        config={matrixConfig}
                        cells={exec.riskHeatmap}
                        showSwapToggle={false}
                    />
                </ChartFocusWrapper>
                <ChartFocusWrapper kpiKey="evidence">
                    <ExpiryCalendar
                        id="expiry-calendar"
                        items={exec.upcomingExpirations}
                    />
                </ChartFocusWrapper>
            </div>

            {/* ─── Trend Section ─── */}
            {trends &&
            trends.daysAvailable >= 2 &&
            trends.dataPoints?.length ? (
                <TrendSection trends={trends} />
            ) : (
                <TrendEmptyState />
            )}

            {/* ─── Next Best Action + Recent Activity (v2-PR-11) ─── */}
            {/* The Quick-Actions 6-button grid was retired in favour of
                a state-driven decisive recommendation. The 3-link
                "Quick add" row below the CTA preserves the most-used
                create affordances without the 6-button noise. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <NextBestActionCard
                    input={{
                        coveragePercent: exec.controlCoverage.coveragePercent,
                        overdueEvidence: exec.evidenceExpiry.overdue,
                        overdueTasks: exec.taskSummary.overdue,
                        highRisks: exec.stats.highRisks,
                    }}
                    tenantHref={href}
                    quickAdds={[
                        { label: t('addRisk'), href: href('/risks') },
                        { label: t('addEvidence'), href: href('/evidence') },
                        { label: t('newPolicy'), href: href('/policies') },
                    ]}
                />

                {/* RecentActivityCard remains a server component;
                    rendered by the parent page and passed in here. */}
                {children ?? (
                    <Card className="space-y-compact">
                        <Skeleton className="h-4 w-full sm:w-32" />
                        <div className="space-y-tight">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex items-start gap-tight">
                                    <Skeleton className="h-3 w-full sm:w-28 shrink-0" />
                                    <Skeleton
                                        className={`h-3 ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </Card>
                )}
            </div>
        </DashboardLayout>
        </DashboardChartProvider>
    );
}

// ─── Chart focus wrapper (R17-PR9) ───────────────────────────────────
//
// Generic wrapper that gives any dashboard chart the same
// focus-or-dim affordance the RiskDistributionSection got in PR-8.
// Pass `kpiKey` matching the KpiCard that "owns" this chart;
// when that KPI is selected, the wrapper applies the brand ring
// (focused). When ANY OTHER KPI is selected, it dims to 60%.
// Null selection ⇒ baseline render.
//
// The wrapper is a plain `<div>` (no card chassis of its own) so
// it composes cleanly around an already-styled section without
// double-bordering. The `rounded-lg` mirrors the underlying card's
// radius so the ring traces the card boundary, not a wider rect.

function ChartFocusWrapper({
    kpiKey,
    children,
}: {
    kpiKey: DashboardKpiKey;
    children: React.ReactNode;
}) {
    const { selectedKpi } = useDashboardChartFilter();
    const isFocused = selectedKpi === kpiKey;
    const isDimmed = selectedKpi !== null && !isFocused;
    return (
        <div
            data-chart-focus={isFocused ? 'true' : undefined}
            data-chart-dimmed={isDimmed ? 'true' : undefined}
            data-chart-focus-key={kpiKey}
            className={cn(
                "rounded-lg transition-opacity duration-200 ease-out",
                isFocused &&
                    "ring-2 ring-brand-default ring-offset-2 ring-offset-bg-page",
                isDimmed && "opacity-60",
            )}
        >
            {children}
        </div>
    );
}

// ─── Interactive KPI Grid (R17-PR7) ──────────────────────────────────
//
// Sits inside <DashboardChartProvider> so it can subscribe to the
// chart-filter context. Each tile is a clickable button that
// toggles the dashboard's selectedKpi. PR-8+ will subscribe the
// charts to the same focus to filter their data.

// B1 — KPIs that have a corresponding chart on the dashboard. A
// click on one of these focuses the chart (donut, trend card, or
// matrix); a click on a KPI OUTSIDE this set has no chart to light
// up — entering the "dim everything except none" state is what made
// the earlier behaviour feel broken ("I clicked tasks and nothing
// happened, everything just dimmed"). Those KPIs now navigate to
// the entity list page instead, which is the user's likely intent.
const CHART_BOUND_KPIS: ReadonlySet<DashboardKpiKey> = new Set([
    'coverage',
    'risks',
    'evidence',
    'findings',
]);

// Per-KPI nav target for the non-chart-bound subset.
const KPI_NAV_HREF: Partial<Record<DashboardKpiKey, string>> = {
    tasks: '/tasks',
    policies: '/policies',
};

function InteractiveKpiGrid({
    exec,
    trendBundle,
    t,
}: {
    exec: ExecutiveDashboardPayload;
    trendBundle: KpiTrendBundle | undefined;
    t: (key: string, opts?: any) => string;
}) {
    const { selectedKpi, toggleSelectedKpi } = useDashboardChartFilter();
    const router = useRouter();
    const href = useTenantHref();
    const isSelected = (kpi: DashboardKpiKey) => selectedKpi === kpi;
    const click = (kpi: DashboardKpiKey) => () => {
        if (CHART_BOUND_KPIS.has(kpi)) {
            toggleSelectedKpi(kpi);
            return;
        }
        // Non-chart-bound KPI — navigate to the entity list page.
        const dest = KPI_NAV_HREF[kpi];
        if (dest) router.push(href(dest));
    };

    return (
        <div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-default"
            id="kpi-grid"
        >
            <KpiCard
                id="kpi-coverage"
                label={t('controls')}
                value={exec.controlCoverage.coveragePercent}
                format="percent"
                icon={ShieldCheck}
                gradient="from-emerald-500 to-teal-500"
                subtitle={`${exec.controlCoverage.implemented} of ${exec.controlCoverage.applicable} implemented`}
                trend={trendBundle?.coverage}
                trendVariant="success"
                onClick={click('coverage')}
                selected={isSelected('coverage')}
            />
            <KpiCard
                id="kpi-risks"
                label={t('risks')}
                value={exec.stats.risks}
                icon={AlertTriangle}
                gradient="from-amber-500 to-orange-500"
                subtitle={t('highCritical', { count: exec.stats.highRisks })}
                trend={trendBundle?.risks}
                trendVariant="warning"
                onClick={click('risks')}
                selected={isSelected('risks')}
            />
            <KpiCard
                id="kpi-evidence"
                label={t('evidence')}
                value={exec.stats.evidence}
                icon={Paperclip}
                gradient="from-purple-500 to-pink-500"
                subtitle={`${exec.evidenceExpiry.overdue} overdue`}
                trend={trendBundle?.evidence}
                trendVariant="error"
                onClick={click('evidence')}
                selected={isSelected('evidence')}
            />
            <KpiCard
                id="kpi-tasks"
                label={t('openTasks')}
                value={exec.stats.openTasks}
                icon={CheckCircle2}
                gradient="from-indigo-500 to-blue-500"
                subtitle={`${exec.taskSummary.overdue} overdue`}
                onClick={click('tasks')}
                selected={isSelected('tasks')}
            />
            <KpiCard
                id="kpi-policies"
                label="Policies"
                value={exec.policySummary.total}
                icon={FileText}
                gradient="from-sky-500 to-cyan-500"
                subtitle={`${exec.policySummary.published} published`}
                onClick={click('policies')}
                selected={isSelected('policies')}
            />
            <KpiCard
                id="kpi-findings"
                label={t('openFindings')}
                value={exec.stats.openFindings}
                icon={Bug}
                gradient="from-red-500 to-rose-500"
                trend={trendBundle?.findings}
                trendVariant="error"
                onClick={click('findings')}
                selected={isSelected('findings')}
            />
        </div>
    );
}

// ─── Risk Distribution ───────────────────────────────────────────────
//
// R17-PR8 — the Risk Distribution card now subscribes to the
// dashboard chart-filter context. When the "Risks" KPI tile is
// selected, the card gains a brand-default ring + brighter glow
// (matches the selected tile's affordance). When ANY OTHER KPI is
// selected, the card dims (opacity-60) — visually signalling
// "the focus is elsewhere right now". When no KPI is selected,
// the card renders unchanged (the baseline byte-for-byte).

function RiskDistributionSection({
    exec,
}: {
    exec: ExecutiveDashboardPayload;
}) {
    const { riskBySeverity, riskByStatus } = exec;
    const { selectedKpi } = useDashboardChartFilter();
    const isFocused = selectedKpi === 'risks';
    const isDimmed = selectedKpi !== null && !isFocused;
    return (
        <Card
            id="risk-distribution"
            data-chart-focus={isFocused ? 'true' : undefined}
            data-chart-dimmed={isDimmed ? 'true' : undefined}
            className={cn(
                // B3 — card sizing parity with ProgressCard
                // (Control Coverage). Both now `h-full flex flex-col`
                // so the row's two siblings read as deliberately
                // matched in height.
                "h-full flex flex-col transition-opacity duration-200 ease-out",
                isFocused && "ring-2 ring-brand-default ring-offset-2 ring-offset-bg-page",
                isDimmed && "opacity-60",
            )}
        >
            <Heading level={3} className="mb-3">
                Risk Distribution
                {isFocused && (
                    <span
                        className="ml-2 inline-flex items-center rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand-emphasis"
                        data-chart-focus-badge
                    >
                        Focused
                    </span>
                )}
            </Heading>
            <div className="grid grid-cols-2 gap-default items-center">
                <DonutChart
                    id="risk-severity-donut"
                    segments={[
                        { label: 'Critical', value: riskBySeverity.critical, color: '#dc2626' },
                        { label: 'High', value: riskBySeverity.high, color: '#f97316' },
                        { label: 'Medium', value: riskBySeverity.medium, color: '#f59e0b' },
                        { label: 'Low', value: riskBySeverity.low, color: '#22c55e' },
                    ]}
                    size={130}
                    centerLabel={String(
                        riskBySeverity.critical +
                            riskBySeverity.high +
                            riskBySeverity.medium +
                            riskBySeverity.low,
                    )}
                    centerSub="Total"
                    showLegend={false}
                />
                <div className="space-y-tight">
                    {[
                        { label: 'Critical', value: riskBySeverity.critical, color: 'bg-bg-error-emphasis' },
                        { label: 'High', value: riskBySeverity.high, color: 'bg-orange-500' },
                        { label: 'Medium', value: riskBySeverity.medium, color: 'bg-bg-warning-emphasis' },
                        { label: 'Low', value: riskBySeverity.low, color: 'bg-bg-success-emphasis' },
                    ].map((item) => (
                        <div
                            key={item.label}
                            className="flex items-center justify-between text-xs"
                        >
                            <div className="flex items-center gap-1.5">
                                <span
                                    className={`w-2 h-2 rounded-full ${item.color} shrink-0`}
                                />
                                <span className="text-content-muted">{item.label}</span>
                            </div>
                            <span className="text-content-default font-medium tabular-nums">
                                {item.value}
                            </span>
                        </div>
                    ))}
                    <div className="border-t border-border-subtle pt-2 mt-2 flex items-center justify-between text-xs">
                        <span className="text-content-muted">Open / Mitigating</span>
                        <span className="text-content-default font-medium tabular-nums">
                            {riskByStatus.open} / {riskByStatus.mitigating}
                        </span>
                    </div>
                </div>
            </div>
        </Card>
    );
}

// ─── Evidence Status ─────────────────────────────────────────────────

function EvidenceStatusSection({
    exec,
    trendBundle,
}: {
    exec: ExecutiveDashboardPayload;
    trendBundle: KpiTrendBundle | undefined;
}) {
    const { evidenceExpiry } = exec;
    const total =
        evidenceExpiry.overdue +
        evidenceExpiry.dueSoon7d +
        evidenceExpiry.dueSoon30d +
        evidenceExpiry.current;
    const currentPercent =
        total > 0 ? Math.round((evidenceExpiry.current / total) * 100) : 0;
    // PR-A — Evidence Status now matches the Compliance Alerts
    // visual weight: a Card with a Heading, the existing four-row
    // breakdown, a percent-current readout, and (when the trend
    // bundle is available) the same evidence-overdue sparkline
    // that the Trend section's TrendCard uses below — so the user
    // can see the trajectory without scrolling.
    return (
        <Card id="evidence-status">
            <div className="flex items-baseline justify-between mb-3 gap-tight">
                <Heading level={3}>Evidence Status</Heading>
                <span
                    className="text-xs text-content-muted tabular-nums"
                    data-testid="evidence-status-current-percent"
                >
                    {currentPercent}% current
                </span>
            </div>
            {/* PR-A — non-wrapping breakdown. The Heading + total
                live on the Card above; each row is a `{ label,
                value, colorClass }` triplet rendered as a single
                line so the four rows stack into the same vertical
                rhythm Compliance Alerts uses. */}
            <StatusBreakdown
                ariaLabel="Evidence status breakdown"
                size="sm"
                showCount
                showPercent
                items={[
                    { label: 'Overdue', value: evidenceExpiry.overdue, colorClass: 'bg-bg-error-emphasis' },
                    { label: 'Due ≤7d', value: evidenceExpiry.dueSoon7d, colorClass: 'bg-bg-warning-emphasis' },
                    { label: 'Due ≤30d', value: evidenceExpiry.dueSoon30d, colorClass: 'bg-bg-warning-emphasis' },
                    { label: 'Current', value: evidenceExpiry.current, colorClass: 'bg-bg-success-emphasis' },
                ]}
            />
            {trendBundle?.evidence && trendBundle.evidence.length > 1 && (
                <div
                    className="mt-default rounded-md bg-bg-muted/30 px-default py-tight"
                    data-testid="evidence-status-trend"
                >
                    <TrendCard
                        label="Overdue (trend)"
                        value={
                            trendBundle.evidence[trendBundle.evidence.length - 1]
                                .value
                        }
                        points={trendBundle.evidence}
                        colorClassName="text-content-error"
                    />
                </div>
            )}
        </Card>
    );
}

// ─── Compliance Alerts ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ComplianceAlerts({ exec, t }: { exec: ExecutiveDashboardPayload; t: (key: string, opts?: any) => string }) {
    const { stats, evidenceExpiry, taskSummary, vendorSummary, policySummary } = exec;
    const alerts: { color: string; text: string }[] = [];

    if (evidenceExpiry.overdue > 0)
        alerts.push({ color: 'bg-bg-error-emphasis', text: t('overdueEvidence', { count: evidenceExpiry.overdue }) });
    if (stats.pendingEvidence > 0)
        alerts.push({ color: 'bg-bg-warning-emphasis', text: t('evidenceAwaitingReview', { count: stats.pendingEvidence }) });
    if (stats.highRisks > 0)
        alerts.push({ color: 'bg-orange-500', text: t('highCriticalRisks', { count: stats.highRisks }) });
    if (taskSummary.overdue > 0)
        alerts.push({ color: 'bg-bg-error-emphasis', text: `${taskSummary.overdue} overdue tasks` });
    if (policySummary.overdueReview > 0)
        alerts.push({ color: 'bg-bg-warning-emphasis', text: `${policySummary.overdueReview} policies need review` });
    if (vendorSummary.overdueReview > 0)
        alerts.push({ color: 'bg-purple-500', text: `${vendorSummary.overdueReview} vendors need review` });
    if (stats.openFindings > 0)
        alerts.push({ color: 'bg-purple-500', text: t('openAuditFindings', { count: stats.openFindings }) });

    return (
        <Card id="compliance-alerts">
            <Heading level={3} className="mb-3">
                {t('complianceAlerts')}
            </Heading>
            <div className="space-y-tight">
                {alerts.length === 0 ? (
                    <p className="text-content-success text-sm">{t('noAlerts')}</p>
                ) : (
                    alerts.map((alert, i) => (
                        <div key={i} className="flex items-center gap-tight text-sm">
                            <span
                                className={`w-2 h-2 rounded-full ${alert.color} shrink-0`}
                            />
                            <span className="text-content-muted">{alert.text}</span>
                        </div>
                    ))
                )}
            </div>
        </Card>
    );
}

// ─── Trend Section ─────────────────────────────────────────────────

function TrendSection({ trends }: { trends: TrendPayload }) {
    const coveragePoints = trends.dataPoints.map((d) => ({
        date: new Date(d.date),
        value: d.controlCoveragePercent,
    }));
    const risksOpenPoints = trends.dataPoints.map((d) => ({
        date: new Date(d.date),
        value: d.risksOpen,
    }));
    const evidenceOverduePoints = trends.dataPoints.map((d) => ({
        date: new Date(d.date),
        value: d.evidenceOverdue,
    }));
    const findingsPoints = trends.dataPoints.map((d) => ({
        date: new Date(d.date),
        value: d.findingsOpen,
    }));
    return (
        <Card id="trend-section">
            <div className="flex items-center justify-between mb-4">
                <Heading level={3}>
                    Compliance Trends
                </Heading>
                <span className="text-xs text-content-subtle">
                    {trends.daysAvailable} day{trends.daysAvailable !== 1 ? 's' : ''} of data
                </span>
            </div>
            {/* B1 — each TrendCard subscribes to its corresponding KPI
                via `<ChartFocusWrapper>`. Pre-B1 only the coverage +
                evidence cards above the trend section had this binding;
                clicking the findings or risks KPI cards only dimmed
                things without lighting any chart up. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-default">
                <ChartFocusWrapper kpiKey="coverage">
                    <TrendCard
                        label="Coverage"
                        value={coveragePoints[coveragePoints.length - 1].value}
                        format="%"
                        points={coveragePoints}
                        colorClassName="text-content-success"
                    />
                </ChartFocusWrapper>
                <ChartFocusWrapper kpiKey="risks">
                    <TrendCard
                        label="Open Risks"
                        value={risksOpenPoints[risksOpenPoints.length - 1].value}
                        points={risksOpenPoints}
                        colorClassName="text-content-warning"
                    />
                </ChartFocusWrapper>
                <ChartFocusWrapper kpiKey="evidence">
                    <TrendCard
                        label="Overdue Evidence"
                        value={evidenceOverduePoints[evidenceOverduePoints.length - 1].value}
                        points={evidenceOverduePoints}
                        colorClassName="text-content-error"
                    />
                </ChartFocusWrapper>
                <ChartFocusWrapper kpiKey="findings">
                    <TrendCard
                        label="Open Findings"
                        value={findingsPoints[findingsPoints.length - 1].value}
                        points={findingsPoints}
                        colorClassName="text-content-info"
                    />
                </ChartFocusWrapper>
            </div>
        </Card>
    );
}

function TrendEmptyState() {
    return (
        <div
            className={cn(cardVariants({ density: 'none' }), 'flex flex-col items-center justify-center gap-y-4 py-12 px-6')}
            id="trend-section"
        >
            <div className="flex size-14 items-center justify-center rounded-lg border border-border-subtle bg-bg-muted">
                <TrendingUp
                    className="size-6 text-content-muted"
                    aria-hidden="true"
                />
            </div>
            <p className="text-center text-base font-medium text-content-emphasis">
                Compliance Trends
            </p>
            <p className="max-w-sm text-balance text-center text-sm text-content-muted">
                Trend charts will appear here after the daily compliance snapshot runs.
                Snapshots are generated automatically at 05:00 UTC.
            </p>
        </div>
    );
}
