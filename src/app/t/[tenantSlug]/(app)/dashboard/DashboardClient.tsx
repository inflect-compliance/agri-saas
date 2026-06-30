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
import { useTranslations } from 'next-intl';
import {
    AlertTriangle,
    Paperclip,
    TrendingUp,
} from 'lucide-react';

import OnboardingBanner from '@/components/onboarding/OnboardingBanner';
import { Skeleton } from '@/components/ui/skeleton';
import KpiCard from '@/components/ui/KpiCard';
import DonutChart from '@/components/ui/DonutChart';
import { TrendCard } from '@/components/ui/TrendCard';
// PR-A — switched from the auto-wrapping default StatusBreakdown
// to the non-wrapping primitive so the Evidence Status card can
// host the breakdown + a trend mini-chart inside ONE Card without
// nested-cards (the legacy default-export wraps itself in
// cardVariants()).
import { StatusBreakdown } from '@/components/ui/status-breakdown';
import ExpiryCalendar from '@/components/ui/ExpiryCalendar';
import { cn } from '@/lib/cn';

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
import { Heading } from '@/components/ui/typography';
import { Card, cardVariants } from '@/components/ui/card';
import AgDashboardStrip from './AgDashboardStrip';

// Terminal work-item statuses — everything else is an open/active field
// task (mirrors the Farm Tasks list page's status set). Used by the
// masthead hero's open-field-tasks count.
const FARM_TASK_DONE_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELED']);

/** Minimal `/farm-tasks` row — the hero only needs the status to count. */
interface FarmHeroTaskRow {
    id: string;
    status: string;
}

// ─── KPI trend bundle ─────────────────────────────────────────────────

type KpiTrendBundle = {
    risks?: ReadonlyArray<{ date: Date; value: number }>;
    evidence?: ReadonlyArray<{ date: Date; value: number }>;
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
        risks: trends.dataPoints.map((d) => ({
            date: new Date(d.date),
            value: d.risksOpen,
        })),
        evidence: trends.dataPoints.map((d) => ({
            date: new Date(d.date),
            value: d.evidenceOverdue,
        })),
    };
}

// ─── Component ────────────────────────────────────────────────────────

interface DashboardClientProps {
    initialExec: ExecutiveDashboardPayload;
    initialTrends: TrendPayload | null;
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

    // UI-15: the dashboard no longer surfaces a notifications button on a new
    // notification — the top-bar notifications bell is the single canonical
    // affordance. Header carries no extra action here.
    const headerActions = undefined;

    // Masthead hero — open field tasks. The legacy control-coverage hero
    // was retired when the compliance surfaces left the farm app. Reads
    // the same `/farm-tasks` list the Farm Tasks page uses (SWR-cached,
    // shared) and counts rows whose status is not terminal. 0 while the
    // list is still loading / empty — no skeleton flash.
    const { data: farmTasks } = useTenantSWR<FarmHeroTaskRow[]>('/farm-tasks');
    const openFarmTasks = (Array.isArray(farmTasks) ? farmTasks : []).filter(
        (task) => !FARM_TASK_DONE_STATUSES.has(task.status),
    ).length;

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

            {/* ─── Agriculture strip (module-gated) ───
                A small "your farm today" row that sits ABOVE the fixed GRC
                cards. Renders nothing for a pure-GRC tenant (neither the
                JOURNAL nor INVENTORY module enabled). */}
            <AgDashboardStrip />

            {/* ─── Masthead — Hero metric (farm: open field tasks) ─── */}
            <HeroMetric
                eyebrow="Farm tasks"
                value={openFarmTasks}
                description="open field tasks"
                data-testid="dashboard-hero"
            />

            {/* ─── KPI Grid — R17-PR7: each tile is a keyboard-accessible
                 button wired into the dashboard chart-filter context.
                 Clicking a tile focuses its chart. ─── */}
            <InteractiveKpiGrid exec={exec} trendBundle={trendBundle} t={t} />

            {/* ─── Risk Distribution + Evidence Status ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-default">
                <RiskDistributionSection exec={exec} />
                <ChartFocusWrapper kpiKey="evidence">
                    <EvidenceStatusSection
                        exec={exec}
                        trendBundle={trendBundle}
                    />
                </ChartFocusWrapper>
            </div>

            {/* ─── Compliance Alerts ─── */}
            <ComplianceAlerts exec={exec} t={t} />

            {/* ─── Evidence Expiry ─── */}
            {/* Subscribes to the evidence KPI focus graph (composes with
                <ChartFocusWrapper> like the trend cards). The risk heatmap
                that previously shared this row was removed. */}
            <ChartFocusWrapper kpiKey="evidence">
                <ExpiryCalendar
                    id="expiry-calendar"
                    items={exec.upcomingExpirations}
                />
            </ChartFocusWrapper>

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
                        overdueEvidence: exec.evidenceExpiry.overdue,
                        highRisks: exec.stats.highRisks,
                    }}
                    tenantHref={href}
                    quickAdds={[
                        { label: t('addRisk'), href: href('/risks') },
                        { label: t('addEvidence'), href: href('/evidence') },
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
    id,
}: {
    kpiKey: DashboardKpiKey;
    children: React.ReactNode;
    /** Optional anchor id so the KPI click-to-scroll can target a
        chart that has no inner id of its own (e.g. the trend cards). */
    id?: string;
}) {
    const { selectedKpi } = useDashboardChartFilter();
    const isFocused = selectedKpi === kpiKey;
    const isDimmed = selectedKpi !== null && !isFocused;
    return (
        <div
            id={id}
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

// Every KPI tile now has a corresponding chart on the dashboard, so a
// click ALWAYS focuses that chart (donut, trend card, or matrix) —
// never navigates. The earlier B1 workaround navigated tasks/policies
// to their list page because they had no chart to light up; they now
// own the Task-status and Policy-status donuts below, so the whole
// grid behaves consistently (click = focus, no surprise navigation).

// Each KPI's owning chart, by DOM id, for the click-to-scroll below.
const CHART_SCROLL_TARGETS: Record<DashboardKpiKey, string> = {
    risks: 'risk-distribution',
    evidence: 'evidence-status',
};

// Bring a KPI's owning chart into view when the tile is focused, but
// only if it isn't already fully on screen (e.g. it sits below the
// fold). Already-visible charts don't jump.
function scrollChartIntoView(kpi: DashboardKpiKey) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(CHART_SCROLL_TARGETS[kpi]);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!fullyVisible) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

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
    const isSelected = (kpi: DashboardKpiKey) => selectedKpi === kpi;
    // Every tile is chart-bound now: a click focuses its chart. When
    // focusing (not clearing), also scroll that chart into view if it's
    // below the current viewport. The rAF defer lets the focus ring
    // paint before we measure/scroll.
    const click = (kpi: DashboardKpiKey) => () => {
        const willFocus = selectedKpi !== kpi;
        toggleSelectedKpi(kpi);
        if (willFocus) {
            requestAnimationFrame(() => scrollChartIntoView(kpi));
        }
    };

    return (
        <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-default"
            id="kpi-grid"
        >
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
    const { stats, evidenceExpiry, vendorSummary } = exec;
    const alerts: { color: string; text: string }[] = [];

    if (evidenceExpiry.overdue > 0)
        alerts.push({ color: 'bg-bg-error-emphasis', text: t('overdueEvidence', { count: evidenceExpiry.overdue }) });
    if (stats.pendingEvidence > 0)
        alerts.push({ color: 'bg-bg-warning-emphasis', text: t('evidenceAwaitingReview', { count: stats.pendingEvidence }) });
    if (stats.highRisks > 0)
        alerts.push({ color: 'bg-orange-500', text: t('highCriticalRisks', { count: stats.highRisks }) });
    if (vendorSummary.overdueReview > 0)
        alerts.push({ color: 'bg-purple-500', text: `${vendorSummary.overdueReview} vendors need review` });

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
    const risksOpenPoints = trends.dataPoints.map((d) => ({
        date: new Date(d.date),
        value: d.risksOpen,
    }));
    const evidenceOverduePoints = trends.dataPoints.map((d) => ({
        date: new Date(d.date),
        value: d.evidenceOverdue,
    }));
    return (
        <Card id="trend-section">
            <div className="flex items-center justify-between mb-4">
                <Heading level={3}>
                    Trends
                </Heading>
                <span className="text-xs text-content-subtle">
                    {trends.daysAvailable} day{trends.daysAvailable !== 1 ? 's' : ''} of data
                </span>
            </div>
            {/* Each TrendCard subscribes to its corresponding KPI via
                `<ChartFocusWrapper>` so clicking a KPI tile lights up its
                trend. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-default">
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
