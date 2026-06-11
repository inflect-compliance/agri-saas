'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBreakdown } from '@/components/ui/status-breakdown';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';
import { KPIStat } from '@/components/ui/metric';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SkeletonDashboard } from '@/components/ui/skeleton';
import { getStatusTone } from '@/lib/design/status-tone';
import { LossExceedanceCurve } from '@/components/ui/charts';
import { formatCompactCurrency, type CoherenceReport } from '@/lib/risk-coherence';
import type { StalenessReport } from '@/app-layer/usecases/risk-staleness';
import { MonteCarloPanel } from './MonteCarloPanel';
import { VelocityCard } from './VelocityCard';

// B10 — Quantitative risk analytics shape. Mirrors the
// RiskQuantitativeAnalytics interface in
// `src/app-layer/usecases/risk-analytics.ts`.
type QuantitativeAnalytics = {
    totals: {
        totalCount: number;
        quantifiedCount: number;
        totalAle: number;
        avgAle: number | null;
        maxAle: number | null;
    };
    topByAle: Array<{
        id: string;
        title: string;
        category: string | null;
        sleAmount: number;
        aroAmount: number;
        ale: number;
    }>;
    byCategory: Array<{ category: string; count: number; totalAle: number }>;
    lecPoints: Array<{
        threshold: number;
        exceedanceCount: number;
        exceedanceFraction: number;
    }>;
};

function formatMoney(v: number | null): string {
    if (v == null) return '—';
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
    return `$${v.toFixed(0)}`;
}

// RQ2-6 — appetite payload from GET /risk-appetite (config + status).
type AppetitePayload = {
    config: {
        totalAleThreshold: number | null;
        singleRiskAleMax: number | null;
    } | null;
    status: {
        status: 'NONE' | 'WITHIN' | 'APPROACHING' | 'BREACHED';
        portfolioAle: number;
        activeBreaches: number;
    } | null;
};

type Risk = {
    id: string;
    title: string;
    category: string | null;
    status: string;
    treatmentOwner: string | null;
    score: number;
    inherentScore: number;
    likelihood: number;
    impact: number;
    nextReviewAt: string | null;
};

// Polish PR-7 — risk heatmap tone delegates to `getStatusTone` with
// the `score-0-25` scale (5×5 likelihood × impact).
const HEATMAP_COLOR = (s: number) => {
    const tone = getStatusTone(s, 'score-0-25');
    return `${tone.bg} ${tone.content}`;
};

export default function RiskDashboardPage() {
    const apiUrl = useTenantApiUrl();
    const href = useTenantHref();
    const tenant = useTenantContext();
    const t = useTranslations('riskManager');

    const [risks, setRisks] = useState<Risk[]>([]);
    const [loading, setLoading] = useState(true);
    // B10 — quantitative analytics, fetched in parallel with the
    // risk list. Failure-soft: a failed analytics load just hides
    // the section without breaking the dashboard.
    const [analytics, setAnalytics] = useState<QuantitativeAnalytics | null>(null);
    // RQ2-5 — coherence report, failure-soft like analytics.
    const [coherence, setCoherence] = useState<CoherenceReport | null>(null);
    // RQ2-6 — appetite config + live status for the LEC markers.
    const [appetite, setAppetite] = useState<AppetitePayload | null>(null);
    // RQ2-8 — staleness report, failure-soft like the others.
    const [staleness, setStaleness] = useState<StalenessReport | null>(null);

    useEffect(() => {
        fetch(apiUrl('/risks/coherence'))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => setCoherence(data as CoherenceReport | null))
            .catch(() => setCoherence(null));
    }, [apiUrl]);

    useEffect(() => {
        fetch(apiUrl('/risks/staleness'))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => setStaleness(data as StalenessReport | null))
            .catch(() => setStaleness(null));
    }, [apiUrl]);

    useEffect(() => {
        fetch(apiUrl('/risk-appetite'))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => setAppetite(data as AppetitePayload | null))
            .catch(() => setAppetite(null));
    }, [apiUrl]);

    useEffect(() => {
        fetch(apiUrl('/risks'))
            .then(r => r.json())
            .then(setRisks)
            .catch(() => setRisks([]))
            .finally(() => setLoading(false));
    }, [apiUrl]);

    useEffect(() => {
        fetch(apiUrl('/risks/analytics'))
            .then((r) => (r.ok ? r.json() : null))
            // eslint-disable-next-line react-hooks/set-state-in-effect
            .then((data) => setAnalytics(data as QuantitativeAnalytics | null))
            .catch(() => setAnalytics(null));
    }, [apiUrl]);

    // KPIs
    const total = risks.length;
    const avgScore = total ? (risks.reduce((s, r) => s + r.inherentScore, 0) / total).toFixed(1) : '0.0';
    const openCount = risks.filter(r => r.status === 'OPEN' || r.status === 'MITIGATING').length;
    const now = new Date();
    const overdueRisks = risks.filter(r => r.nextReviewAt && new Date(r.nextReviewAt) < now);

    // Status breakdown
    const statusCounts = risks.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
    }, {});

    // Heatmap
    const heatmapCounts: Record<string, number> = {};
    risks.forEach(r => {
        const key = `${r.likelihood}-${r.impact}`;
        heatmapCounts[key] = (heatmapCounts[key] || 0) + 1;
    });

    if (loading) {
        return <SkeletonDashboard />;
    }

    return (
        <DashboardLayout
            header={{
                title: t('dashboardTitle'),
                description: `${tenant.tenantName} — ${t('riskCount', { count: total })}`,
                actions: (
                    <Link href={href('/risks')} className={buttonVariants({ variant: 'secondary' })} id="back-to-register">
                        {t('riskRegister')}
                    </Link>
                ),
            }}
        >

            {/* KPI Cards — Polish PR-2: KPIStat primitive. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                <Card>
                    <KPIStat value={total} label={t('totalRisks')} />
                </Card>
                <Card>
                    <KPIStat value={avgScore} label={t('avgScore')} tone="attention" />
                </Card>
                <Card>
                    <KPIStat value={openCount} label={t('openRisks')} tone="success" />
                </Card>
                <Card>
                    <KPIStat
                        value={overdueRisks.length}
                        label={t('overdueReviews')}
                        tone={overdueRisks.length > 0 ? 'critical' : 'success'}
                    />
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-section">
                {/* Status Breakdown — Epic 59: StatusBreakdown primitive. */}
                <Card>
                    <Heading level={3} className="mb-4">{t('statusBreakdown')}</Heading>
                    <StatusBreakdown
                        ariaLabel="Risk status breakdown"
                        total={total}
                        showPercent
                        emptyState={
                            <p className="text-content-subtle text-sm">
                                {t('noRisksYet')}
                            </p>
                        }
                        items={Object.entries(statusCounts)
                            .sort(([, a], [, b]) => b - a)
                            .map(([status, count]) => ({
                                id: status,
                                label: status,
                                value: count,
                                variant: 'brand' as const,
                            }))}
                    />
                </Card>

                {/* Heatmap */}
                <Card>
                    <Heading level={3} className="mb-4">{t('heatmapTitle')}</Heading>
                    <div className="grid grid-cols-[auto_repeat(5,1fr)] gap-1 text-xs">
                        <div></div>
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="text-center text-content-subtle font-medium pb-1">{i}</div>
                        ))}
                        {[5, 4, 3, 2, 1].map(l => (
                            <>
                                <div key={`l-${l}`} className="flex items-center text-content-subtle font-medium pr-2">{l}</div>
                                {[1, 2, 3, 4, 5].map(i => {
                                    const count = heatmapCounts[`${l}-${i}`] || 0;
                                    const s = l * i;
                                    return (
                                        <div
                                            key={`${l}-${i}`}
                                            className={`h-10 rounded flex items-center justify-center font-medium transition-colors duration-150 ease-out cursor-default ${HEATMAP_COLOR(s)}`}
                                            title={`L${l}×I${i} = ${s} (${count})`}
                                        >
                                            {count > 0 ? count : ''}
                                        </div>
                                    );
                                })}
                            </>
                        ))}
                        <div className="text-content-subtle text-[10px] mt-1">L↑</div>
                        <div className="col-span-5 text-center text-content-subtle text-[10px] mt-1">Impact →</div>
                    </div>
                </Card>
            </div>

            {/* B10 — Quantitative analytics. Renders only when the
                tenant has at least one quantified risk (SLE + ARO
                populated). The block is laid out as: KPI strip
                (totals), top-10 ALE table, loss-exceedance curve. */}
            {analytics && analytics.totals.quantifiedCount > 0 && (
                <Card data-testid="risk-quant-analytics">
                    <Heading level={2} className="mb-2">Quantitative analytics</Heading>
                    <p className="text-sm text-content-muted mb-default">
                        {analytics.totals.quantifiedCount} of{' '}
                        {analytics.totals.totalCount} risks quantified
                        (SLE × ARO).
                    </p>
                    {/* KPI tiles inside the analytics card — plain
                        divs with a subtle inset boundary. The outer
                        frame already provides the container; the
                        inset bg + rounded edge gives each KPI a
                        "tile" feel without a nested primitive. */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-default mb-default">
                        <div className="rounded-md bg-bg-muted/30 px-default py-default" data-testid="risk-quant-tile-total">
                            <KPIStat
                                value={formatMoney(analytics.totals.totalAle)}
                                label="Total ALE / year"
                            />
                        </div>
                        <div className="rounded-md bg-bg-muted/30 px-default py-default" data-testid="risk-quant-tile-avg">
                            <KPIStat
                                value={formatMoney(analytics.totals.avgAle)}
                                label="Average ALE"
                                tone="attention"
                            />
                        </div>
                        <div className="rounded-md bg-bg-muted/30 px-default py-default" data-testid="risk-quant-tile-max">
                            <KPIStat
                                value={formatMoney(analytics.totals.maxAle)}
                                label="Max single ALE"
                                tone="critical"
                            />
                        </div>
                        <div className="rounded-md bg-bg-muted/30 px-default py-default" data-testid="risk-quant-tile-cats">
                            <KPIStat
                                value={analytics.byCategory.length}
                                label="Categories carrying loss"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-section">
                        <div>
                            <Heading level={3} className="mb-2">Top 10 by ALE</Heading>
                            <div className="space-y-tight">
                                {analytics.topByAle.map((row) => (
                                    <Link
                                        key={row.id}
                                        href={href(`/risks/${row.id}`)}
                                        className="flex justify-between gap-default p-2 rounded text-sm hover:bg-bg-muted/50 transition-colors duration-100 ease-out"
                                        data-testid={`risk-quant-top-row-${row.id}`}
                                    >
                                        <span className="truncate text-content-emphasis">
                                            {row.title}
                                        </span>
                                        <span className="tabular-nums text-content-muted">
                                            {formatMoney(row.ale)}
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                        <div>
                            <Heading level={3} className="mb-2">Loss exceedance curve</Heading>
                            <p className="text-xs text-content-subtle mb-tight">
                                For each loss threshold (x), the curve
                                shows the share of quantified risks whose
                                annualised loss is ≥ that threshold.
                            </p>
                            <LossExceedanceCurve
                                data={analytics.lecPoints}
                                testId="risk-loss-exceedance-curve"
                                ariaLabel="Risk portfolio loss exceedance curve"
                                // RQ2-6 — the per-risk appetite cap is a
                                // genuine x-threshold on this curve:
                                // every step right of the line is a risk
                                // outside appetite.
                                referenceLines={
                                    appetite?.config?.singleRiskAleMax != null
                                        ? [
                                              {
                                                  value: appetite.config.singleRiskAleMax,
                                                  label: 'Per-risk appetite',
                                              },
                                          ]
                                        : undefined
                                }
                            />
                            {/* The portfolio ceiling is a Σ-constraint,
                                not a per-risk x-threshold — drawing it
                                on the curve would lie. It gets an
                                honest utilisation line instead. */}
                            {appetite?.config?.totalAleThreshold != null && appetite.status && (
                                <p
                                    className="mt-tight text-xs text-content-muted tabular-nums"
                                    data-testid="lec-portfolio-appetite-note"
                                >
                                    Portfolio ALE {formatMoney(appetite.status.portfolioAle)} of{' '}
                                    {formatMoney(appetite.config.totalAleThreshold)} ceiling (
                                    {Math.round(
                                        (appetite.status.portfolioAle /
                                            appetite.config.totalAleThreshold) *
                                            100,
                                    )}
                                    %).
                                </p>
                            )}
                        </div>
                    </div>
                </Card>
            )}

            {/* RQ2-5 — qual ↔ quant coherence. Renders only when the
                detector has enough quantified risks to rank; an
                agreeing portfolio gets a one-line all-clear. */}
            {coherence && coherence.quantifiedCount >= coherence.minRequired && (
                <Card data-testid="risk-coherence-widget">
                    <Heading level={2} className="mb-2">Qual ↔ quant coherence</Heading>
                    {coherence.flags.length === 0 ? (
                        <p className="text-sm text-content-muted">
                            Qualitative scores and loss estimates agree across the{' '}
                            {coherence.quantifiedCount} quantified risks — no rank
                            contradictions detected.
                        </p>
                    ) : (
                        <>
                            <p className="text-sm text-content-muted mb-default">
                                {coherence.flags.length} risk
                                {coherence.flags.length > 1 ? 's' : ''} where the
                                matrix and the money disagree — one of the two
                                assessments is probably wrong.
                            </p>
                            <div className="space-y-tight">
                                {coherence.flags.map((f) => {
                                    // polish #4 — a scan-fast chip
                                    // tells the eye which language is
                                    // the louder one before the
                                    // sentence reads. $↑ #↓ = money
                                    // says big, matrix says small;
                                    // and the inverse for #↑ $↓.
                                    const moneyBigger = f.direction === 'QUANT_HIGH_QUAL_LOW';
                                    return (
                                        <Link
                                            key={f.riskId}
                                            href={href(`/risks/${f.riskId}`)}
                                            className="flex items-center justify-between gap-default p-2 rounded text-sm hover:bg-bg-muted/50 transition-colors duration-100 ease-out"
                                            data-testid={`risk-coherence-row-${f.riskId}`}
                                            data-direction={f.direction}
                                        >
                                            <span className="flex items-center gap-tight truncate">
                                                <span
                                                    aria-hidden="true"
                                                    className="inline-flex items-center gap-px rounded border border-border-subtle px-1 text-[10px] tabular-nums text-content-emphasis"
                                                    data-testid={`risk-coherence-chip-${f.riskId}`}
                                                >
                                                    {moneyBigger ? '€↑ score↓' : 'score↑ €↓'}
                                                </span>
                                                <span className="truncate text-content-emphasis">{f.title}</span>
                                            </span>
                                            <span className="shrink-0 tabular-nums text-content-muted">
                                                {moneyBigger
                                                    ? `score ${f.score} vs ${formatCompactCurrency(f.ale)} — losses say this is bigger`
                                                    : `score ${f.score} vs ${formatCompactCurrency(f.ale)} — losses say this is smaller`}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </Card>
            )}

            {/* RQ2-8 — stale assessments. Renders only when rot
                exists; an all-fresh register stays quiet. */}
            {staleness && staleness.staleCount > 0 && (
                <Card data-testid="risk-staleness-widget">
                    <Heading level={2} className="mb-2">Stale assessments</Heading>
                    <p className="text-sm text-content-muted mb-default">
                        {staleness.staleCount} of {staleness.totalCount} risks carry an
                        assessment the world may have moved past — overdue review,
                        untouched for {staleness.maxAssessmentAgeDays}+ days, or control
                        tests newer than the residual.
                    </p>
                    <div className="space-y-tight">
                        {staleness.staleRisks.slice(0, 10).map((r) => {
                            // polish #5 — rot-severity left-border tint
                            // draws the eye to multi-reason rows; the
                            // widget already sorts rot-first, this just
                            // makes the gradient visible.
                            const tone =
                                r.reasons.length >= 3
                                    ? 'border-l-content-error'
                                    : r.reasons.length === 2
                                      ? 'border-l-content-warning'
                                      : 'border-l-border-subtle';
                            return (
                                <Link
                                    key={r.riskId}
                                    href={href(`/risks/${r.riskId}`)}
                                    className={`flex items-center justify-between gap-default p-2 pl-3 rounded border-l-2 ${tone} text-sm hover:bg-bg-muted/50 transition-colors duration-100 ease-out`}
                                    data-testid={`risk-stale-row-${r.riskId}`}
                                    data-reason-count={r.reasons.length}
                                >
                                    <span className="truncate text-content-emphasis">{r.title}</span>
                                    <span className="shrink-0 text-xs text-content-muted">{r.description}</span>
                                </Link>
                            );
                        })}
                        {staleness.staleRisks.length > 10 && (
                            <p className="text-xs text-content-subtle">
                                + {staleness.staleRisks.length - 10} more
                            </p>
                        )}
                    </div>
                </Card>
            )}

            {/* RQ-3 — Monte Carlo simulation */}
            <MonteCarloPanel />

            {/* RQ-9 — risk velocity */}
            <VelocityCard />

            {/* Overdue */}
            {overdueRisks.length > 0 && (
                <Card className="border-border-error">
                    <Heading level={2} className="mb-3 text-content-error">{t('overdueReviewsTitle')}</Heading>
                    <div className="space-y-tight">
                        {overdueRisks.map(r => {
                            const daysOverdue = Math.floor((now.getTime() - new Date(r.nextReviewAt!).getTime()) / 86400000);
                            return (
                                <Link key={r.id} href={href(`/risks/${r.id}`)} className="flex justify-between items-center p-2 rounded hover:bg-bg-error transition">
                                    <span className="text-sm text-content-emphasis">{r.title}</span>
                                    <span className="text-xs text-content-error">{t('daysOverdue', { days: daysOverdue })} · {r.treatmentOwner || t('noOwner')}</span>
                                </Link>
                            );
                        })}
                    </div>
                </Card>
            )}
        </DashboardLayout>
    );
}
