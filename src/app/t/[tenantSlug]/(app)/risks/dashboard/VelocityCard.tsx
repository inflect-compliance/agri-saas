'use client';

/* RQ-9 — Risk velocity card: portfolio direction + fastest rising/falling. */
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowTrendUp } from '@/components/ui/icons/nucleo/arrow-trend-up';
import { PercentageArrowDown } from '@/components/ui/icons/nucleo/percentage-arrow-down';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { useTenantApiUrl, useMoneyFormatter } from '@/lib/tenant-context-provider';

interface Vel { riskId: string; title: string; deltaPercent: number }
interface VelocityResult {
    topRising: Vel[]; topFalling: Vel[];
    portfolioVelocity: { currentTotalAle: number; previousTotalAle: number; deltaPercent: number; trend: string };
}
// RQ3-OB-A — money speaks the tenant's currency (useMoneyFormatter).

export function VelocityCard() {
    const tv = useTranslations('riskDashboard');
    const apiUrl = useTenantApiUrl();
    const money = useMoneyFormatter();
    const [v, setV] = useState<VelocityResult | null>(null);

    useEffect(() => {
        let live = true;
        fetch(apiUrl('/risks/velocity')).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setV(d.velocity); }).catch(() => {});
        return () => { live = false; };
    }, [apiUrl]);

    if (!v) return null;
    const pv = v.portfolioVelocity;
    const improving = pv.trend === 'FALLING'; // falling ALE = improving
    if (v.topRising.length === 0 && v.topFalling.length === 0 && pv.previousTotalAle === 0) return null;

    return (
        <Card data-testid="risk-velocity">
            <Heading level={2} className="mb-default">{tv('velocityTitle')}</Heading>
            <div className="mb-default flex items-center gap-default text-sm">
                <span className="text-content-muted">{tv('portfolio')}</span>
                <span className="tabular-nums text-content-emphasis">{money(pv.previousTotalAle)} → {money(pv.currentTotalAle)}</span>
                <StatusBadge variant={improving ? 'success' : pv.trend === 'RISING' ? 'error' : 'neutral'}>
                    {pv.deltaPercent >= 0 ? '+' : ''}{pv.deltaPercent.toFixed(1)}% {improving ? tv('improving') : pv.trend === 'RISING' ? tv('worsening') : tv('stable')}
                </StatusBadge>
            </div>
            <div className="grid grid-cols-1 gap-section md:grid-cols-2">
                <div>
                    <Heading level={3} className="mb-2 text-xs uppercase text-content-subtle">{tv('fastestRising')}</Heading>
                    {v.topRising.length === 0 ? <p className="text-xs text-content-subtle">{tv('none')}</p> : v.topRising.map((r) => (
                        <div key={r.riskId} className="flex items-center gap-tight py-tight text-sm">
                            <ArrowTrendUp className="size-3.5 shrink-0 text-content-error" />
                            <span className="truncate text-content-emphasis">{r.title}</span>
                            <span className="ml-auto tabular-nums text-content-error">+{r.deltaPercent.toFixed(0)}%</span>
                        </div>
                    ))}
                </div>
                <div>
                    <Heading level={3} className="mb-2 text-xs uppercase text-content-subtle">{tv('fastestFalling')}</Heading>
                    {v.topFalling.length === 0 ? <p className="text-xs text-content-subtle">{tv('none')}</p> : v.topFalling.map((r) => (
                        <div key={r.riskId} className="flex items-center gap-tight py-tight text-sm">
                            <PercentageArrowDown className="size-3.5 shrink-0 text-content-success" />
                            <span className="truncate text-content-emphasis">{r.title}</span>
                            <span className="ml-auto tabular-nums text-content-success">{r.deltaPercent.toFixed(0)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    );
}
