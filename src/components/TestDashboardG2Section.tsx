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
import DonutChart, { type DonutSegment } from '@/components/ui/DonutChart';
import { MiniAreaChart } from '@/components/ui/mini-area-chart';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { formatDate } from '@/lib/format-date';

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
    const tenantHref = useTenantHref();

    const donutSegments = useMemo<DonutSegment[]>(
        () => [
            { label: 'Pass', value: passRuns, color: '#22c55e' },
            { label: 'Fail', value: failRuns, color: '#ef4444' },
            { label: 'Inconclusive', value: inconclusiveRuns, color: '#f59e0b' },
        ],
        [passRuns, failRuns, inconclusiveRuns],
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
            className="space-y-4"
            id="test-dashboard-g2-section"
            data-testid="test-dashboard-g2-section"
        >
            <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Automation</h2>
                <span className="text-xs text-content-subtle">
                    {automation.plansScheduledActive} scheduled •{' '}
                    {automation.plansManual} manual •{' '}
                    {automation.plansScript + automation.plansIntegration}{' '}
                    automated
                </span>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* ─── Pass/Fail Donut ───────────────────────────── */}
                <div
                    className="glass-card p-6"
                    data-testid="test-dashboard-g2-donut"
                >
                    <h3 className="text-sm font-semibold mb-4">
                        Result distribution ({period}d)
                    </h3>
                    {totalCompleted === 0 ? (
                        <p className="text-content-subtle text-sm">
                            No completed runs in this period yet.
                        </p>
                    ) : (
                        <div className="flex justify-center">
                            <DonutChart
                                segments={donutSegments}
                                centerLabel={`${passPct}%`}
                                centerSub="Pass rate"
                                size={180}
                            />
                        </div>
                    )}
                </div>

                {/* ─── Overdue Scheduled Tests ───────────────────── */}
                <div
                    className="glass-card p-6"
                    data-testid="test-dashboard-g2-overdue"
                >
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold">
                            Overdue scheduled
                        </h3>
                        <span
                            className={`badge badge-xs ${
                                automation.overdueScheduled > 0
                                    ? 'badge-danger'
                                    : 'badge-success'
                            }`}
                            data-testid="test-dashboard-g2-overdue-count"
                        >
                            {automation.overdueScheduled}
                        </span>
                    </div>
                    {overdueRows.length === 0 ? (
                        <p className="text-content-subtle text-sm">
                            {automation.plansScheduledActive === 0
                                ? 'No scheduled plans yet. Schedule a plan from its detail page.'
                                : 'All scheduled plans are on track.'}
                        </p>
                    ) : (
                        <div className="space-y-1.5">
                            {overdueRows.map((row) => (
                                <Link
                                    key={row.planId}
                                    href={tenantHref(
                                        `/controls/${row.controlId}/tests/${row.planId}`,
                                    )}
                                    className="flex items-center justify-between p-2 rounded hover:bg-bg-default/30 transition group"
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
                                            {Math.abs(row.daysUntilRun)}d overdue
                                        </div>
                                        <div className="text-xs text-content-subtle">
                                            {formatDate(row.nextRunAtIso)}
                                        </div>
                                    </div>
                                </Link>
                            ))}
                            {automation.overdueScheduled > overdueRows.length && (
                                <div className="text-xs text-content-subtle pt-1">
                                    + {automation.overdueScheduled - overdueRows.length} more
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ─── Trend Sparkline ───────────────────────────── */}
                <div
                    className="glass-card p-6"
                    data-testid="test-dashboard-g2-trend"
                >
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold">
                            Daily runs ({period}d)
                        </h3>
                        <span className="text-xs text-content-subtle">
                            {totalCompleted} total
                        </span>
                    </div>
                    {!sparklineHasAnyRun ? (
                        <p className="text-content-subtle text-sm">
                            No runs to chart yet.
                        </p>
                    ) : (
                        <div className="h-24">
                            <MiniAreaChart
                                data={sparklineData}
                                variant="brand"
                                aria-label="Daily completed test runs"
                            />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
