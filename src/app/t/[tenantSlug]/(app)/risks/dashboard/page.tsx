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

    useEffect(() => {
        fetch(apiUrl('/risks'))
            .then(r => r.json())
            .then(setRisks)
            .catch(() => setRisks([]))
            .finally(() => setLoading(false));
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
