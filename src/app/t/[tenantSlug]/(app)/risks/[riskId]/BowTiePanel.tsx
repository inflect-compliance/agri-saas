'use client';

/* RQ-7 — Bow-tie analysis: threat → event → consequence with control barriers.
   A read-time projection rendered either as an interactive xyflow canvas
   (default) or the accessible column list. */
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { ShieldCheck } from '@/components/ui/icons/nucleo/shield-check';
import { Bolt } from '@/components/ui/icons/nucleo/bolt';
import { TriangleWarning } from '@/components/ui/icons/nucleo/triangle-warning';
import { CurrencyDollar } from '@/components/ui/icons/nucleo/currency-dollar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { useTenantApiUrl, useMoneyFormatter } from '@/lib/tenant-context-provider';
import type { BowTieGraph } from './BowTieCanvas';

// xyflow is client-only + heavy — load the canvas on demand.
const BowTieCanvas = dynamic(() => import('./BowTieCanvas').then((m) => m.BowTieCanvas), {
    ssr: false,
    loading: () => <div className="h-[480px] w-full rounded-md border border-border-default bg-bg-muted/20" />,
});

interface Barrier { controlId: string; title: string; status: string; effectiveness: number | null }
interface Projection {
    event: { riskId: string; title: string; category: string | null; score: number; ale: number | null };
    threats: Array<{ id: string; label: string; tef: number | null; vulnerability: number | null }>;
    preventiveBarriers: Barrier[];
    consequences: Array<{ id: string; label: string; magnitude: number | null; type: string }>;
    mitigatingBarriers: Barrier[];
}
// RQ3-OB-A — money speaks the tenant's currency (useMoneyFormatter).
const effVariant = (e: number | null) => (e == null ? 'neutral' : e >= 70 ? 'success' : e >= 40 ? 'warning' : 'error');

function BarrierChip({ b }: { b: Barrier }) {
    return (
        <div className="rounded-md border border-border-subtle bg-bg-muted/20 px-default py-tight text-sm">
            <div className="flex items-center justify-between gap-tight">
                <span className="flex items-center gap-tight truncate text-content-emphasis"><ShieldCheck className="size-3.5 shrink-0" />{b.title}</span>
                <StatusBadge variant={effVariant(b.effectiveness)}>{b.effectiveness == null ? '—' : `${b.effectiveness}%`}</StatusBadge>
            </div>
        </div>
    );
}

export function BowTiePanel({ riskId }: { riskId: string }) {
    const tb = useTranslations('riskBowtie');
    const apiUrl = useTenantApiUrl();
    const money = useMoneyFormatter();
    const [p, setP] = useState<Projection | null>(null);
    const [graph, setGraph] = useState<BowTieGraph | null>(null);
    const [view, setView] = useState<'canvas' | 'list'>('canvas');

    useEffect(() => {
        let live = true;
        fetch(apiUrl(`/risks/${riskId}/bowtie`)).then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (live && d) { setP(d.projection); setGraph(d.graph ?? null); }
        }).catch(() => {});
        return () => { live = false; };
    }, [apiUrl, riskId]);

    if (!p) return <Card className="p-6"><p className="text-sm text-content-muted">{tb('loading')}</p></Card>;

    return (
        <Card className="space-y-default p-6" data-testid="risk-bowtie">
            <div className="flex flex-wrap items-center justify-between gap-default">
                <Heading level={2}>{tb('title')}</Heading>
                <span className="flex gap-tight">
                    <Button size="sm" variant={view === 'canvas' ? 'primary' : 'secondary'} onClick={() => setView('canvas')}>{tb('diagram')}</Button>
                    <Button size="sm" variant={view === 'list' ? 'primary' : 'secondary'} onClick={() => setView('list')}>{tb('list')}</Button>
                </span>
            </div>
            <p className="text-xs text-content-muted">{tb('intro')}</p>

            {view === 'canvas' && graph && <BowTieCanvas graph={graph} />}

            {view === 'list' && (
            <div className="grid grid-cols-1 gap-section lg:grid-cols-5">
                {/* Threats */}
                <div className="space-y-tight">
                    <Heading level={3} className="text-xs uppercase text-content-subtle">{tb('threats')}</Heading>
                    {p.threats.map((t) => (
                        <div key={t.id} className="flex items-center gap-tight rounded-md border border-border-subtle px-default py-tight text-sm text-content-emphasis"><Bolt className="size-3.5 shrink-0" />{t.label}</div>
                    ))}
                </div>
                {/* Preventive barriers */}
                <div className="space-y-tight">
                    <Heading level={3} className="text-xs uppercase text-content-subtle">{tb('preventive')}</Heading>
                    {p.preventiveBarriers.length === 0 ? <p className="text-xs text-content-subtle">{tb('none')}</p> : p.preventiveBarriers.map((b) => <BarrierChip key={b.controlId} b={b} />)}
                </div>
                {/* Event */}
                <div className="flex flex-col items-center justify-center">
                    <div className="w-full rounded-lg border border-border-emphasis bg-bg-muted/30 p-default text-center">
                        <TriangleWarning className="mx-auto size-6 text-content-muted" />
                        <div className="font-medium text-content-emphasis">{p.event.title}</div>
                        <div className="mt-tight text-xs text-content-muted">{tb('scorePerYear', { score: p.event.score, ale: money(p.event.ale) })}</div>
                    </div>
                </div>
                {/* Mitigating barriers */}
                <div className="space-y-tight">
                    <Heading level={3} className="text-xs uppercase text-content-subtle">{tb('mitigating')}</Heading>
                    {p.mitigatingBarriers.length === 0 ? <p className="text-xs text-content-subtle">{tb('none')}</p> : p.mitigatingBarriers.map((b) => <BarrierChip key={b.controlId} b={b} />)}
                </div>
                {/* Consequences */}
                <div className="space-y-tight">
                    <Heading level={3} className="text-xs uppercase text-content-subtle">{tb('consequences')}</Heading>
                    {p.consequences.map((c) => (
                        <div key={c.id} className="rounded-md border border-border-subtle px-default py-tight text-sm">
                            <div className="flex justify-between gap-tight">
                                <span className="flex items-center gap-tight truncate text-content-emphasis"><CurrencyDollar className="size-3.5 shrink-0" />{c.label}</span>
                                <span className="tabular-nums text-content-muted">{money(c.magnitude)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            )}
        </Card>
    );
}
