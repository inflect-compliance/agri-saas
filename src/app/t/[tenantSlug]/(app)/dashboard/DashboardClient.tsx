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
import StatusBreakdown from '@/components/ui/StatusBreakdown';
import { RiskMatrix } from '@/components/ui/RiskMatrix';
import ExpiryCalendar from '@/components/ui/ExpiryCalendar';
import { StatusBadge } from '@/components/ui/status-badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@dub/utils';

import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { CACHE_KEYS } from '@/lib/swr-keys';

import type { ExecutiveDashboardPayload } from '@/app-layer/repositories/DashboardRepository';
import type { TrendPayload } from '@/app-layer/usecases/compliance-trends';
import type { RiskMatrixConfigShape } from '@/lib/risk-matrix/types';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';

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

    return (
        <div className="space-y-6 animate-fadeIn">
            <OnboardingBanner />

            {/* ─── Header ─── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <Heading level={1}>
                        {t('title')}
                    </Heading>
                    <p className="text-content-muted text-sm mt-1">
                        {t('subtitle')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {exec.stats.unreadNotifications > 0 && (
                        <Link
                            href={href('/notifications')}
                            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                        >
                            <Bell className="w-4 h-4" aria-hidden="true" />
                            <StatusBadge variant="error" icon={null} size="sm">
                                {exec.stats.unreadNotifications}
                            </StatusBadge>
                        </Link>
                    )}
                </div>
            </div>

            {/* ─── KPI Grid (6 cards) ─── */}
            <div
                className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
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
                />
                <KpiCard
                    id="kpi-tasks"
                    label={t('openTasks')}
                    value={exec.stats.openTasks}
                    icon={CheckCircle2}
                    gradient="from-indigo-500 to-blue-500"
                    subtitle={`${exec.taskSummary.overdue} overdue`}
                />
                <KpiCard
                    id="kpi-policies"
                    label="Policies"
                    value={exec.policySummary.total}
                    icon={FileText}
                    gradient="from-sky-500 to-cyan-500"
                    subtitle={`${exec.policySummary.published} published`}
                />
                <KpiCard
                    id="kpi-findings"
                    label={t('openFindings')}
                    value={exec.stats.openFindings}
                    icon={Bug}
                    gradient="from-red-500 to-rose-500"
                    trend={trendBundle?.findings}
                    trendVariant="error"
                />
            </div>

            {/* ─── Control Coverage + Risk Distribution ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                    footer={
                        <Link
                            href={href('/clauses')}
                            className="text-[var(--brand-emphasis)] hover:text-[var(--brand-muted)]"
                        >
                            {t('viewAllClauses')}
                        </Link>
                    }
                />
                <RiskDistributionSection exec={exec} />
            </div>

            {/* ─── Evidence Status + Compliance Alerts ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <EvidenceStatusSection exec={exec} />
                <ComplianceAlerts exec={exec} t={t} />
            </div>

            {/* ─── Risk Heatmap + Evidence Expiry ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RiskMatrix
                    id="risk-heatmap"
                    config={matrixConfig}
                    cells={exec.riskHeatmap}
                    showSwapToggle={false}
                />
                <ExpiryCalendar
                    id="expiry-calendar"
                    items={exec.upcomingExpirations}
                />
            </div>

            {/* ─── Trend Section ─── */}
            {trends &&
            trends.daysAvailable >= 2 &&
            trends.dataPoints?.length ? (
                <TrendSection trends={trends} />
            ) : (
                <TrendEmptyState />
            )}

            {/* ─── Quick Actions + Recent Activity ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                    <Heading level={3} className="mb-3">
                        {t('quickActions')}
                    </Heading>
                    <div className="grid grid-cols-2 gap-2">
                        <Link
                            href={href('/assets')}
                            className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }))}
                        >
                            {t('addAsset')}
                        </Link>
                        <Link
                            href={href('/risks')}
                            className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }))}
                        >
                            {t('addRisk')}
                        </Link>
                        <Link
                            href={href('/evidence')}
                            className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }))}
                        >
                            {t('addEvidence')}
                        </Link>
                        <Link
                            href={href('/audits')}
                            className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }))}
                        >
                            {t('newAudit')}
                        </Link>
                        <Link
                            href={href('/policies')}
                            className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }))}
                        >
                            {t('newPolicy')}
                        </Link>
                        <Link
                            href={href('/reports')}
                            className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }))}
                        >
                            {t('exportReports')}
                        </Link>
                    </div>
                </Card>

                {/* RecentActivityCard remains a server component;
                    rendered by the parent page and passed in here. */}
                {children ?? (
                    <Card className="space-y-3">
                        <Skeleton className="h-4 w-full sm:w-32" />
                        <div className="space-y-2">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex items-start gap-2">
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
        </div>
    );
}

// ─── Risk Distribution ───────────────────────────────────────────────

function RiskDistributionSection({
    exec,
}: {
    exec: ExecutiveDashboardPayload;
}) {
    const { riskBySeverity, riskByStatus } = exec;
    return (
        <Card id="risk-distribution">
            <Heading level={3} className="mb-3">
                Risk Distribution
            </Heading>
            <div className="grid grid-cols-2 gap-4 items-center">
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
                <div className="space-y-2">
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

function EvidenceStatusSection({ exec }: { exec: ExecutiveDashboardPayload }) {
    const { evidenceExpiry } = exec;
    return (
        <StatusBreakdown
            id="evidence-status"
            label="Evidence Status"
            items={[
                { label: 'Overdue', value: evidenceExpiry.overdue, color: 'bg-bg-error-emphasis' },
                { label: 'Due ≤7d', value: evidenceExpiry.dueSoon7d, color: 'bg-bg-warning-emphasis' },
                { label: 'Due ≤30d', value: evidenceExpiry.dueSoon30d, color: 'bg-bg-warning-emphasis' },
                { label: 'Current', value: evidenceExpiry.current, color: 'bg-bg-success-emphasis' },
            ]}
        />
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
            <div className="space-y-2">
                {alerts.length === 0 ? (
                    <p className="text-content-success text-sm">{t('noAlerts')}</p>
                ) : (
                    alerts.map((alert, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <TrendCard
                    label="Coverage"
                    value={coveragePoints[coveragePoints.length - 1].value}
                    format="%"
                    points={coveragePoints}
                    colorClassName="text-content-success"
                />
                <TrendCard
                    label="Open Risks"
                    value={risksOpenPoints[risksOpenPoints.length - 1].value}
                    points={risksOpenPoints}
                    colorClassName="text-content-warning"
                />
                <TrendCard
                    label="Overdue Evidence"
                    value={evidenceOverduePoints[evidenceOverduePoints.length - 1].value}
                    points={evidenceOverduePoints}
                    colorClassName="text-content-error"
                />
                <TrendCard
                    label="Open Findings"
                    value={findingsPoints[findingsPoints.length - 1].value}
                    points={findingsPoints}
                    colorClassName="text-content-info"
                />
            </div>
        </Card>
    );
}

function TrendEmptyState() {
    return (
        <div
            className="glass-card flex flex-col items-center justify-center gap-y-4 py-12 px-6"
            id="trend-section"
        >
            <div className="flex size-14 items-center justify-center rounded-xl border border-border-subtle bg-bg-muted">
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
