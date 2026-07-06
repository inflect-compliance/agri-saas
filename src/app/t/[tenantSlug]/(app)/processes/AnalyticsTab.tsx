'use client';

/**
 * Automation analytics tab (Automation Epic 9).
 *
 * Near-real-time visibility into automation health: rule counts, execution
 * volume over time, success/error rates, SLA breaches, and the most-fired
 * rules. Reads the aggregated /automation/analytics endpoint.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { KPIStat } from '@/components/ui/metric';
import { MiniAreaChart } from '@/components/ui/mini-area-chart';
import type { TimeSeriesPoint } from '@/components/ui/charts';

interface Analytics {
    totalRules: number;
    enabledRules: number;
    windowDays: number;
    executions: Array<{ date: string; succeeded: number; failed: number; skipped: number }>;
    topRules: Array<{ ruleId: string; name: string; count: number; successRate: number }>;
    slaBreaches: number;
    avgDurationMs: number;
    errorRate: number;
    totalExecutions: number;
}

const WINDOWS = [7, 30, 90] as const;

function Stat({ label, value }: { label: string; value: string | number }) {
    // Numbers flow through KPIStat (locks tabular-nums + the single metric
    // typographic register — metric-typography ratchet).
    return (
        <Card>
            <KPIStat label={label} value={value} size="md" />
        </Card>
    );
}

export function AnalyticsTab() {
    const t = useTranslations('processes.analytics');
    const [days, setDays] = useState<number>(30);
    const { data, isLoading } = useTenantSWR<Analytics>(
        `${CACHE_KEYS.automation.analytics()}?days=${days}`,
    );

    const series: TimeSeriesPoint[] = useMemo(
        () =>
            (data?.executions ?? []).map((e) => ({
                date: new Date(e.date),
                value: e.succeeded + e.failed + e.skipped,
            })),
        [data],
    );

    if (!isLoading && data && data.totalRules === 0) {
        return (
            <div className="p-default">
                <EmptyState
                    title={t('emptyTitle')}
                    description={t('emptyDesc')}
                />
            </div>
        );
    }

    return (
        <div className="space-y-section p-default" data-testid="automation-analytics">
            <div className="flex gap-tight">
                {WINDOWS.map((w) => (
                    <button
                        key={w}
                        type="button"
                        onClick={() => setDays(w)}
                        className={`rounded-full px-2.5 py-0.5 text-xs ${days === w ? 'bg-bg-inverted text-content-inverted' : 'bg-bg-muted text-content-muted'}`}
                    >
                        {t('dayWindow', { days: w })}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-default md:grid-cols-3 lg:grid-cols-6">
                <Stat label={t('enabledRules')} value={`${data?.enabledRules ?? 0}/${data?.totalRules ?? 0}`} />
                <Stat label={t('executions', { days })} value={data?.totalExecutions ?? 0} />
                <Stat label={t('successRate')} value={`${100 - (data?.errorRate ?? 0)}%`} />
                <Stat label={t('avgDuration')} value={`${data?.avgDurationMs ?? 0}ms`} />
                <Stat label={t('slaBreaches')} value={data?.slaBreaches ?? 0} />
                <Stat label={t('errorRate')} value={`${data?.errorRate ?? 0}%`} />
            </div>

            <Card>
                <p className="mb-default text-[11px] uppercase tracking-wide text-content-subtle">
                    {t('executionsOverTime')}
                </p>
                {series.length >= 2 ? (
                    <div className="h-40 w-full">
                        <MiniAreaChart data={series} variant="brand" aria-label={t('executionsOverTime')} className="h-full w-full" />
                    </div>
                ) : (
                    <p className="text-sm text-content-muted">{t('notEnoughData')}</p>
                )}
            </Card>

            <Card>
                <p className="mb-default text-[11px] uppercase tracking-wide text-content-subtle">
                    {t('mostFired')}
                </p>
                {data && data.topRules.length > 0 ? (
                    <ul className="space-y-tight">
                        {data.topRules.map((r) => (
                            <li key={r.ruleId} className="flex items-center justify-between gap-default text-sm">
                                <span className="truncate text-content-default">{r.name}</span>
                                <span className="shrink-0 tabular-nums text-content-muted">
                                    {t('ruleRunsOk', { count: r.count, rate: r.successRate })}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-content-muted">{t('windowEmpty')}</p>
                )}
            </Card>
        </div>
    );
}
