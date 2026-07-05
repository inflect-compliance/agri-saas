'use client';
/**
 * Epic G-2 — Test dashboard automation section.
 *
 * Three widgets on top of the existing dashboard primitives:
 *
 *   1. Pass/Fail/Inconclusive donut          (DonutChart)
 *   2. Overdue scheduled tests list          (custom Link list)
 *   3. Per-day completed-run trend sparkline (MiniAreaChart)
 *
 * Reads the merged G-2 fields the dashboard API was extended to
 * return in prompt 4 (`automation`, `upcoming`, `trend`) plus the
 * legacy run counters (`passRuns`, `failRuns`, `inconclusiveRuns`)
 * which already drive the existing distribution cards.
 *
 * Mounts inside the existing TestDashboardPage; no chart-platform
 * exception — all visuals use the shared Epic 59 primitives.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import DonutChart, { type DonutSegment } from '@/components/ui/DonutChart';
import { MiniAreaChart } from '@/components/ui/mini-area-chart';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { formatDate } from '@/lib/format-date';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';

// ─── Types ─────────────────────────────────────────────────────────

export interface DashboardUpcomingItem {
    planId: string;
    planName: string;
    controlId: string;
    controlName: string;
    automationType: 'MANUAL' | 'SCRIPT' | 'INTEGRATION';
    schedule: string | null;
    scheduleTimezone: string | null;
    nextRunAtIso: string;
    daysUntilRun: number;
}

export interface TestDashboardG2SectionProps {
    period: number;
    passRuns: number;
    failRuns: number;
    inconclusiveRuns: number;
    automation: {
        plansManual: number;
        plansScript: number;
        plansIntegration: number;
        plansScheduledActive: number;
        overdueScheduled: number;
    };
    upcoming: DashboardUpcomingItem[];
    trend: {
        days: string[];
        pass: number[];
        fail: number[];
        inconclusive: number[];
    };
}

// ─── Component ─────────────────────────────────────────────────────

export function TestDashboardG2Section({
    period,
    passRuns,
    failRuns,
    inconclusiveRuns,
    automation,
    upcoming,
    trend,
}: TestDashboardG2SectionProps) {
    const t = useTranslations('testDashboard');
    const tenantHref = useTenantHref();

    const donutSegments = useMemo<DonutSegment[]>(
        () => [
            { label: t('segPass'), value: passRuns, color: '#22c55e' },
            { label: t('segFail'), value: failRuns, color: '#ef4444' },
            { label: t('segInconclusive'), value: inconclusiveRuns, color: '#f59e0b' },
        ],
        [t, passRuns, failRuns, inconclusiveRuns],
    );
    const totalCompleted = passRuns + failRuns + inconclusiveRuns;
    const passPct =
        totalCompleted > 0 ? Math.round((passRuns / totalCompleted) * 100) : 0;

    // Sparkline data — daily completed-run counts (sum of all three
    // categories per day). MiniAreaChart wants TimeSeriesPoint[].
    const sparklineData = useMemo(() => {
        return trend.days.map((iso, i) => ({
            date: new Date(iso),
            value: (trend.pass[i] ?? 0) +
                (trend.fail[i] ?? 0) +
                (trend.inconclusive[i] ?? 0),
        }));
    }, [trend]);
    const sparklineHasAnyRun = sparklineData.some((p) => p.value > 0);

    // Overdue list = upcoming items with daysUntilRun < 0, sorted by
    // most-overdue-first. Takes the first 5 to keep the card scannable.
    const overdueRows = useMemo(
        () =>
            upcoming
                .filter((u) => u.daysUntilRun < 0)
                .sort((a, b) => a.daysUntilRun - b.daysUntilRun)
                .slice(0, 5),
        [upcoming],
    );

    return (
        <section
            className="space-y-default"
            id="test-dashboard-g2-section"
            data-testid="test-dashboard-g2-section"
        >
            <div className="flex items-baseline justify-between">
                <Heading level={2}>{t('automation')}</Heading>
                <span className="text-xs text-content-subtle">
                    {t('planSummary', {
                        scheduled: automation.plansScheduledActive,
                        manual: automation.plansManual,
                        automated: automation.plansScript + automation.plansIntegration,
                    })}
                </span>
            </div>

            <div className="grid lg:grid-cols-3 gap-section">
                {/* ─── Pass/Fail Donut ───────────────────────────── */}
                <div
                    className={cardVariants()}
                    data-testid="test-dashboard-g2-donut"
                >
                    <Heading level={3} className="mb-4">
                        {t('resultDistribution', { period })}
                    </Heading>
                    {totalCompleted === 0 ? (
                        <p className="text-content-subtle text-sm">
                            {t('noCompletedRuns')}
                        </p>
                    ) : (
                        <div className="flex justify-center">
                            <DonutChart
                                segments={donutSegments}
                                centerLabel={`${passPct}%`}
                                centerSub={t('passRate')}
                                size={180}
                            />
                        </div>
                    )}
                </div>

                {/* ─── Overdue Scheduled Tests ───────────────────── */}
                <div
                    className={cardVariants()}
                    data-testid="test-dashboard-g2-overdue"
                >
                    <div className="flex items-center justify-between mb-4">
                        <Heading level={3}>
                            {t('overdueScheduled')}
                        </Heading>
                        <StatusBadge variant={automation.overdueScheduled > 0
                                    ? 'error'
                                    : 'success'} size="sm" data-testid="test-dashboard-g2-overdue-count">
                            {automation.overdueScheduled}
                        </StatusBadge>
                    </div>
                    {overdueRows.length === 0 ? (
                        <p className="text-content-subtle text-sm">
                            {automation.plansScheduledActive === 0
                                ? t('noScheduledPlans')
                                : t('allOnTrack')}
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {overdueRows.map((row) => (
                                <Link
                                    key={row.planId}
                                    href={tenantHref(
                                        `/controls/${row.controlId}/tests/${row.planId}`,
                                    )}
                                    className="flex items-center justify-between p-2 rounded hover:bg-bg-muted/50 transition group"
                                    data-testid={`test-dashboard-g2-overdue-row-${row.planId}`}
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm text-content-emphasis truncate">
                                            {row.planName}
                                        </div>
                                        <div className="text-xs text-content-subtle truncate">
                                            {row.controlName}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0 ml-3">
                                        <div className="text-xs text-content-error font-semibold">
                                            {t('daysOverdue', { days: Math.abs(row.daysUntilRun) })}
                                        </div>
                                        <div className="text-xs text-content-subtle">
                                            {formatDate(row.nextRunAtIso)}
                                        </div>
                                    </div>
                                </Link>
                            ))}
                            {automation.overdueScheduled > overdueRows.length && (
                                <div className="text-xs text-content-subtle pt-1">
                                    + {t('moreCount', { count: automation.overdueScheduled - overdueRows.length })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ─── Trend Sparkline ───────────────────────────── */}
                <div
                    className={cardVariants()}
                    data-testid="test-dashboard-g2-trend"
                >
                    <div className="flex items-center justify-between mb-4">
                        <Heading level={3}>
                            {t('dailyRuns', { period })}
                        </Heading>
                        <span className="text-xs text-content-subtle">
                            {t('totalCount', { count: totalCompleted })}
                        </span>
                    </div>
                    {!sparklineHasAnyRun ? (
                        <p className="text-content-subtle text-sm">
                            {t('noRunsToChart')}
                        </p>
                    ) : (
                        <div className="h-24">
                            <MiniAreaChart
                                data={sparklineData}
                                variant="brand"
                                aria-label={t('dailyRunsAria')}
                            />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
