'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBreakdown } from '@/components/ui/status-breakdown';

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

const HEATMAP_COLOR = (s: number) => {
    if (s <= 5) return 'bg-bg-success text-content-success';
    if (s <= 12) return 'bg-bg-warning text-content-warning';
    if (s <= 18) return 'bg-orange-900/60 text-orange-300';
    return 'bg-bg-error text-content-error';
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
        return <div className="glass-card p-12 text-center animate-pulse text-content-subtle">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{t('dashboardTitle')}</h1>
                    <p className="text-content-muted text-sm">{tenant.tenantName} — {t('riskCount', { count: total })}</p>
                </div>
                <Link href={href('/risks')} className={buttonVariants({ variant: 'secondary' })} id="back-to-register">
                    {t('riskRegister')}
                </Link>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-5 text-center">
                    <p className="text-xs text-content-muted uppercase tracking-wider">{t('totalRisks')}</p>
                    <p className="text-3xl font-bold mt-2">{total}</p>
                </div>
                <div className="glass-card p-5 text-center">
                    <p className="text-xs text-content-muted uppercase tracking-wider">{t('avgScore')}</p>
                    <p className="text-3xl font-bold mt-2 text-content-warning">{avgScore}</p>
                </div>
                <div className="glass-card p-5 text-center">
                    <p className="text-xs text-content-muted uppercase tracking-wider">{t('openRisks')}</p>
                    <p className="text-3xl font-bold mt-2 text-content-success">{openCount}</p>
                </div>
                <div className="glass-card p-5 text-center">
                    <p className="text-xs text-content-muted uppercase tracking-wider">{t('overdueReviews')}</p>
                    <p className="text-3xl font-bold mt-2 text-content-error">{overdueRisks.length}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Status Breakdown — Epic 59: StatusBreakdown primitive. */}
                <div className="glass-card p-5">
                    <h2 className="font-semibold mb-4">{t('statusBreakdown')}</h2>
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
                </div>

                {/* Heatmap */}
                <div className="glass-card p-5">
                    <h2 className="font-semibold mb-4">{t('heatmapTitle')}</h2>
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
                                            className={`h-10 rounded flex items-center justify-center font-medium transition hover:scale-105 cursor-default ${HEATMAP_COLOR(s)}`}
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
                </div>
            </div>

            {/* Overdue */}
            {overdueRisks.length > 0 && (
                <div className="glass-card p-5 border-border-error">
                    <h2 className="font-semibold mb-3 text-content-error">{t('overdueReviewsTitle')}</h2>
                    <div className="space-y-2">
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
                </div>
            )}
        </div>
    );
}
