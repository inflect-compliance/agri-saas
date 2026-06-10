'use client';

/* RQ-4 — Risk scenarios: list, create, simulate, compare baseline vs scenario. */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';

interface Scenario { id: string; name: string; status: string; investmentCost: number | null; computedRoi: number | null; createdAt: string }
interface Comparison {
    baseline: { portfolioAle: { mean: number; p95: number; p99: number } };
    scenario: { portfolioAle: { mean: number; p95: number; p99: number } };
    delta: { meanAleDelta: number; varP95Delta: number; varP99Delta: number; roi: number | null };
    perRiskDeltas: Array<{ riskId: string; title: string; baselineAle: number; scenarioAle: number; deltaPercent: number }>;
}
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;

export default function RiskScenariosPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const [scenarios, setScenarios] = useState<Scenario[]>([]);
    const [name, setName] = useState('');
    const [investment, setInvestment] = useState('');
    const [cmp, setCmp] = useState<Comparison | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { const r = await fetch(apiUrl('/risks/scenarios')); if (r.ok) setScenarios((await r.json()).scenarios); } catch { /* ignore */ }
    }, [apiUrl]);
    useEffect(() => { void load(); }, [load]);

    const create = async () => {
        if (!name.trim()) return;
        setBusy(true);
        try {
            await fetch(apiUrl('/risks/scenarios'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), investmentCost: investment.trim() ? Number(investment) : null }),
            });
            setName(''); setInvestment(''); await load();
        } finally { setBusy(false); }
    };

    const simulate = async (id: string) => {
        setBusy(true); setCmp(null);
        try {
            const r = await fetch(apiUrl(`/risks/scenarios/${id}/simulate`), { method: 'POST' });
            if (r.ok) { setCmp((await r.json()).comparison); await load(); }
        } finally { setBusy(false); }
    };

    const archive = async (id: string) => { await fetch(apiUrl(`/risks/scenarios/${id}`), { method: 'DELETE' }); await load(); };

    return (
        <div className="space-y-section">
            <PageBreadcrumbs items={[{ label: 'Risks', href: tenantHref('/risks') }, { label: 'Scenarios' }]} />
            <Heading level={1}>Risk Scenarios</Heading>

            <Card className="space-y-default p-6">
                <Heading level={2}>New scenario</Heading>
                <p className="text-sm text-content-muted">Create a what-if scenario, then simulate to compare its portfolio VaR against the live baseline. Overrides (field patches / synthetic risks) are authored via the scenarios API.</p>
                <div className="flex flex-wrap items-end gap-default">
                    <label className="block flex-1"><span className="text-xs text-content-muted">Name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="WAF implementation" /></label>
                    <label className="block"><span className="text-xs text-content-muted">Investment ($)</span><Input type="text" inputMode="decimal" value={investment} onChange={(e) => setInvestment(e.target.value)} placeholder="130000" /></label>
                    <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>Create</Button>
                </div>
            </Card>

            <Card className="space-y-default p-6">
                <Heading level={2}>Scenarios</Heading>
                {scenarios.length === 0 ? (
                    <p className="text-sm text-content-muted">No scenarios yet.</p>
                ) : (
                    <ul className="divide-y divide-border-subtle">
                        {scenarios.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-center gap-default py-default text-sm">
                                <StatusBadge variant={s.status === 'SIMULATED' ? 'success' : s.status === 'ARCHIVED' ? 'neutral' : 'info'}>{s.status}</StatusBadge>
                                <span className="font-medium text-content-emphasis">{s.name}</span>
                                {s.investmentCost != null && <span className="text-content-muted">invest {money(s.investmentCost)}</span>}
                                {s.computedRoi != null && <span className="text-content-muted">ROI {s.computedRoi.toFixed(1)}×</span>}
                                <span className="ml-auto flex gap-tight">
                                    {s.status !== 'ARCHIVED' && <Button size="sm" variant="secondary" onClick={() => simulate(s.id)} disabled={busy}>Simulate</Button>}
                                    {s.status !== 'ARCHIVED' && <Button size="sm" variant="ghost" onClick={() => archive(s.id)}>Archive</Button>}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {cmp && (
                <Card className="space-y-default p-6" data-testid="scenario-comparison">
                    <Heading level={2}>Baseline vs scenario</Heading>
                    <table className="w-full text-sm">
                        <thead><tr className="text-content-muted"><th className="text-left">Metric</th><th className="text-right">Baseline</th><th className="text-right">Scenario</th><th className="text-right">Δ</th></tr></thead>
                        <tbody className="tabular-nums">
                            <tr><td>Mean ALE</td><td className="text-right">{money(cmp.baseline.portfolioAle.mean)}</td><td className="text-right">{money(cmp.scenario.portfolioAle.mean)}</td><td className="text-right">{signed(cmp.delta.meanAleDelta)}</td></tr>
                            <tr><td>VaR-95</td><td className="text-right">{money(cmp.baseline.portfolioAle.p95)}</td><td className="text-right">{money(cmp.scenario.portfolioAle.p95)}</td><td className="text-right">{signed(cmp.delta.varP95Delta)}</td></tr>
                            <tr><td>VaR-99</td><td className="text-right">{money(cmp.baseline.portfolioAle.p99)}</td><td className="text-right">{money(cmp.scenario.portfolioAle.p99)}</td><td className="text-right">{signed(cmp.delta.varP99Delta)}</td></tr>
                            {cmp.delta.roi != null && <tr><td>ROI</td><td /><td /><td className="text-right">{cmp.delta.roi.toFixed(1)}×</td></tr>}
                        </tbody>
                    </table>
                    {cmp.perRiskDeltas.length > 0 && (
                        <div>
                            <Heading level={3} className="mb-2">Per-risk impact</Heading>
                            <ul className="space-y-tight">
                                {cmp.perRiskDeltas.map((d) => (
                                    <li key={d.riskId} className="flex justify-between gap-default text-sm">
                                        <span className="truncate text-content-emphasis">{d.title}</span>
                                        <span className="tabular-nums text-content-muted">{money(d.baselineAle)} → {money(d.scenarioAle)} ({d.deltaPercent.toFixed(0)}%)</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>
            )}
        </div>
    );
}
