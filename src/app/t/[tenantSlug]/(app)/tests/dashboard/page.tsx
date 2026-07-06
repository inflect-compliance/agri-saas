'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { ProgressBar, type ProgressBarVariant } from '@/components/ui/progress-bar';
import { ProgressCircle } from '@/components/ui/progress-circle';
import {
    TestDashboardG2Section,
    type DashboardUpcomingItem,
} from '@/components/TestDashboardG2Section';
import { StatusBadge } from '@/components/ui/status-badge';
import { KPIStat, type MetricTone } from '@/components/ui/metric';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SkeletonDashboard } from '@/components/ui/skeleton';
import { Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { AppIcon } from '@/components/icons/AppIcon';

interface DashboardMetrics {
    periodDays: number;
    totalPlans: number;
    totalRuns: number;
    completedRuns: number;
    passRuns: number;
    failRuns: number;
    inconclusiveRuns: number;
    completionRate: number;
    passRate: number;
    failRate: number;
    evidenceRate: number;
    overduePlans: number;
    repeatedFailures: Array<{ controlId: string; controlName: string; controlCode: string | null; failCount: number }>;
    runsWithEvidence: number;
    // Epic G-2 — additive fields the dashboard endpoint merges in
    // (route.ts Promise.alls the legacy + G-2 usecases). Optional
    // because old API consumers may still hit a non-merged response
    // shape during a rolling deploy.
    automation?: {
        plansManual: number;
        plansScript: number;
        plansIntegration: number;
        plansScheduledActive: number;
        overdueScheduled: number;
    };
    upcoming?: DashboardUpcomingItem[];
    trend?: {
        days: string[];
        pass: number[];
        fail: number[];
        inconclusive: number[];
    };
}

interface FrameworkReadiness {
    frameworkKey: string;
    frameworkName: string;
    totalMappedControls: number;
    withTestPlan: number;
    testPlanCoverage: number;
    withRecentRun: number;
    testRunCoverage: number;
    passRate: number;
    recentRuns: number;
    recentPasses: number;
}

// Legacy color prop → Epic 59 ProgressBar variant. Kept as a local
// helper so the dozens of call sites below stay short and readable.
function toProgressVariant(color: string): ProgressBarVariant {
    if (color === 'green') return 'success';
    if (color === 'red') return 'error';
    if (color === 'amber') return 'warning';
    return 'brand';
}

export default function TestDashboardPage() {
    const t = useTranslations('controlTests.dashboard');
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();

    const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
    const [readiness, setReadiness] = useState<FrameworkReadiness[]>([]);
    const [period, setPeriod] = useState(30);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [mRes, rRes] = await Promise.all([
                fetch(apiUrl(`/tests/dashboard?period=${period}`)),
                fetch(apiUrl('/tests/readiness')),
            ]);
            if (mRes.ok) setMetrics(await mRes.json());
            if (rRes.ok) setReadiness(await rRes.json());
        } finally {
            setLoading(false);
        }
    }, [apiUrl, period]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading || !metrics) return <SkeletonDashboard />;

    return (
        <DashboardLayout
            header={{
                title: t('title'),
                titleId: 'dashboard-title',
                description: t('description'),
                actions: (
                    <>
                        <Link href={tenantHref('/tests')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{t('tests')}</Link>
                        <Tooltip content={t('dueQueue')}>
                            <Link href={tenantHref('/tests/due')} aria-label={t('dueQueue')} className={buttonVariants({ variant: 'secondary', size: 'icon' })}>
                                <AppIcon name="clock" size={16} />
                            </Link>
                        </Tooltip>
                        <div className="flex gap-1 bg-bg-default/50 rounded-lg p-1">
                            {[30, 90].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setPeriod(d)}
                                    className={`px-3 py-1 rounded text-xs font-medium transition-colors duration-150 ease-out ${period === d ? 'bg-[var(--brand-default)] text-content-emphasis' : 'text-content-muted hover:text-content-emphasis'}`}
                                    id={`period-${d}-btn`}
                                >
                                    {t('dayWindow', { days: d })}
                                </button>
                            ))}
                        </div>
                    </>
                ),
            }}
        >

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-default">
                <MetricCard label={t('completionRate')} value={`${metrics.completionRate}%`} sub={t('runsSub', { completed: metrics.completedRuns, total: metrics.totalRuns })} color={metrics.completionRate >= 80 ? 'green' : metrics.completionRate >= 50 ? 'amber' : 'red'} />
                <MetricCard label={t('passRate')} value={`${metrics.passRate}%`} sub={t('passedSub', { count: metrics.passRuns })} color={metrics.passRate >= 80 ? 'green' : metrics.passRate >= 50 ? 'amber' : 'red'} />
                <MetricCard label={t('failRate')} value={`${metrics.failRate}%`} sub={t('failedSub', { count: metrics.failRuns })} color={metrics.failRate <= 10 ? 'green' : metrics.failRate <= 30 ? 'amber' : 'red'} />
                <MetricCard label={t('evidenceRate')} value={`${metrics.evidenceRate}%`} sub={t('withEvidenceSub', { count: metrics.runsWithEvidence })} color={metrics.evidenceRate >= 80 ? 'green' : metrics.evidenceRate >= 50 ? 'amber' : 'red'} />
                <MetricCard label={t('overduePlans')} value={String(metrics.overduePlans)} sub={t('needAttention')} color={metrics.overduePlans === 0 ? 'green' : 'red'} />
                <MetricCard label={t('activePlans')} value={String(metrics.totalPlans)} sub={t('total')} color="brand" />
            </div>

            {/* Result Distribution */}
            <div className="grid md:grid-cols-2 gap-section">
                <div className={cardVariants()}>
                    <Heading level={2} className="mb-4">{t('resultDistribution', { period })}</Heading>
                    {metrics.completedRuns === 0 ? (
                        <p className="text-content-subtle text-sm">{t('noCompletedRuns')}</p>
                    ) : (
                        <div className="flex gap-section items-center">
                            {/* Headline gauge — overall pass rate at a glance */}
                            <ProgressCircle
                                progress={metrics.passRate / 100}
                                label={`${metrics.passRate}%`}
                                variant={metrics.passRate >= 80 ? 'success' : metrics.passRate >= 50 ? 'warning' : 'error'}
                                size="sm"
                                aria-label={t('overallPassRateAria')}
                            />
                            <div className="flex-1 space-y-compact">
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-content-success">{t('pass')}</span>
                                    <span className="text-content-muted">{t('passLine', { count: metrics.passRuns, rate: metrics.passRate })}</span>
                                </div>
                                <ProgressBar value={metrics.passRate} variant="success" aria-label={t('passRateAria')} />
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-content-error">{t('fail')}</span>
                                    <span className="text-content-muted">{t('passLine', { count: metrics.failRuns, rate: metrics.failRate })}</span>
                                </div>
                                <ProgressBar value={metrics.failRate} variant="error" aria-label={t('failRateAria')} />
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-content-warning">{t('inconclusive')}</span>
                                    <span className="text-content-muted">{metrics.inconclusiveRuns}</span>
                                </div>
                                <ProgressBar
                                    value={metrics.completedRuns > 0 ? (metrics.inconclusiveRuns / metrics.completedRuns) * 100 : 0}
                                    variant="warning"
                                    aria-label={t('inconclusiveRateAria')}
                                />
                            </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className={cardVariants()}>
                    <Heading level={2} className="mb-4">{t('repeatedFailures')}</Heading>
                    {metrics.repeatedFailures.length === 0 ? (
                        <p className="text-content-subtle text-sm">{t('noRepeatedFailures')}</p>
                    ) : (
                        <div className="space-y-tight">
                            {metrics.repeatedFailures.map(f => (
                                <Link
                                    key={f.controlId}
                                    href={tenantHref(`/controls/${f.controlId}`)}
                                    className="flex justify-between items-center p-2 rounded hover:bg-bg-muted/50 transition"
                                >
                                    <div>
                                        <span className="text-content-emphasis text-sm font-medium">{f.controlCode || f.controlName}</span>
                                        {f.controlCode && <span className="text-content-muted text-xs ml-2">{f.controlName}</span>}
                                    </div>
                                    <StatusBadge variant="error" size="sm">{t('failuresCount', { count: f.failCount })}</StatusBadge>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Epic G-2 — automation: pass/fail donut, overdue scheduled list, trend sparkline */}
            {metrics.automation && metrics.upcoming && metrics.trend && (
                <TestDashboardG2Section
                    period={period}
                    passRuns={metrics.passRuns}
                    failRuns={metrics.failRuns}
                    inconclusiveRuns={metrics.inconclusiveRuns}
                    automation={metrics.automation}
                    upcoming={metrics.upcoming}
                    trend={metrics.trend}
                />
            )}

            {/* Framework Test Readiness */}
            {readiness.length > 0 && (
                <div className={cardVariants()}>
                    <Heading level={2} className="mb-4" id="framework-readiness-title">{t('frameworkCoverage')}</Heading>
                    <p className="text-sm text-content-muted mb-4">
                        {t('frameworkCoverageDesc')}
                    </p>
                    <div className="space-y-section animate-fadeIn">
                        {readiness.map(fw => (
                            <div key={fw.frameworkKey} className="border border-border-default/30 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <Heading level={3}>{fw.frameworkName}</Heading>
                                    <span className="text-xs text-content-muted">{t('mappedControls', { count: fw.totalMappedControls })}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-default">
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-content-muted">{t('testPlanCoverage')}</span>
                                            <span className="text-content-emphasis">{fw.testPlanCoverage}%</span>
                                        </div>
                                        <ProgressBar
                                            value={fw.testPlanCoverage}
                                            variant={toProgressVariant(fw.testPlanCoverage >= 80 ? 'green' : fw.testPlanCoverage >= 50 ? 'amber' : 'red')}
                                            aria-label={t('testPlanCoverageAria', { name: fw.frameworkName })}
                                        />
                                        <p className="text-xs text-content-subtle mt-1">{t('withPlans', { withPlan: fw.withTestPlan, total: fw.totalMappedControls })}</p>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-content-muted">{t('recentRunCoverage')}</span>
                                            <span className="text-content-emphasis">{fw.testRunCoverage}%</span>
                                        </div>
                                        <ProgressBar
                                            value={fw.testRunCoverage}
                                            variant={toProgressVariant(fw.testRunCoverage >= 80 ? 'green' : fw.testRunCoverage >= 50 ? 'amber' : 'red')}
                                            aria-label={t('recentRunCoverageAria', { name: fw.frameworkName })}
                                        />
                                        <p className="text-xs text-content-subtle mt-1">{t('tested', { withRun: fw.withRecentRun, total: fw.totalMappedControls })}</p>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-content-muted">{t('passRate')}</span>
                                            <span className="text-content-emphasis">{fw.passRate}%</span>
                                        </div>
                                        <ProgressBar
                                            value={fw.passRate}
                                            variant={toProgressVariant(fw.passRate >= 80 ? 'green' : fw.passRate >= 50 ? 'amber' : 'red')}
                                            aria-label={t('passRateFwAria', { name: fw.frameworkName })}
                                        />
                                        <p className="text-xs text-content-subtle mt-1">{t('passed', { passes: fw.recentPasses, runs: fw.recentRuns })}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
    const toneMap: Record<string, MetricTone> = {
        green: 'success',
        red: 'critical',
        amber: 'attention',
        brand: 'default',
    };
    return (
        <div className={cardVariants({ density: 'compact' })}>
            <KPIStat
                value={value}
                label={label}
                tone={toneMap[color] ?? 'default'}
                description={sub}
            />
        </div>
    );
}
