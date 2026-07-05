'use client';

/* RQ-8 — Risk correlation matrix editor + PSD validation + auto-suggest. */
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';

interface Matrix { riskIds: string[]; riskTitles: string[]; matrix: number[][]; isPositiveSemiDefinite: boolean }
interface Suggestion { riskAId: string; riskBId: string; suggestedCoefficient: number; reason: string }

// Discrete heat bands → semantic background tokens (no raw colours).
function cellClass(v: number): string {
    if (v >= 0.999) return 'bg-bg-muted/40';
    if (v >= 0.6) return 'bg-bg-error/30';
    if (v >= 0.3) return 'bg-bg-warning/30';
    if (v > 0) return 'bg-bg-warning/10';
    if (v < 0) return 'bg-bg-info/20';
    return '';
}

export default function CorrelationMatrixPage() {
    const tc = useTranslations('riskCorrelations');
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const [m, setM] = useState<Matrix | null>(null);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [sel, setSel] = useState<{ i: number; j: number } | null>(null);
    const [coef, setCoef] = useState('');

    const load = useCallback(async () => {
        try { const r = await fetch(apiUrl('/risks/correlations')); if (r.ok) setM((await r.json()).matrix); } catch { /* ignore */ }
    }, [apiUrl]);
    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!m || !sel) return;
        await fetch(apiUrl('/risks/correlations'), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ riskAId: m.riskIds[sel.i], riskBId: m.riskIds[sel.j], coefficient: Number(coef) }),
        });
        setSel(null); setCoef(''); await load();
    };

    const autoSuggest = async () => {
        try { const r = await fetch(apiUrl('/risks/correlations/suggest')); if (r.ok) setSuggestions((await r.json()).suggestions); } catch { /* ignore */ }
    };
    const applySuggestion = async (s: Suggestion) => {
        await fetch(apiUrl('/risks/correlations'), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ riskAId: s.riskAId, riskBId: s.riskBId, coefficient: s.suggestedCoefficient, rationale: s.reason }),
        });
        setSuggestions((prev) => prev.filter((x) => !(x.riskAId === s.riskAId && x.riskBId === s.riskBId)));
        await load();
    };

    return (
        <div className="space-y-section">
            <PageBreadcrumbs items={[{ label: tc('risks'), href: tenantHref('/risks') }, { label: tc('breadcrumb') }]} />
            <div className="flex items-center justify-between">
                <Heading level={1}>{tc('title')}</Heading>
                <Button variant="secondary" size="sm" onClick={autoSuggest}>{tc('autoSuggest')}</Button>
            </div>

            {!m ? (
                <SkeletonCard lines={4} />
            ) : m.riskIds.length === 0 ? (
                <Card className="p-6"><p className="text-sm text-content-muted">{tc('noRisks')}</p></Card>
            ) : (
                <Card className="space-y-default p-6">
                    <div className="flex items-center gap-default">
                        <StatusBadge variant={m.isPositiveSemiDefinite ? 'success' : 'error'}>
                            {m.isPositiveSemiDefinite ? tc('psd') : tc('notPsd')}
                        </StatusBadge>
                        <span className="text-xs text-content-subtle">{tc('clickCell')}</span>
                    </div>
                    <div className="overflow-auto">
                        <table className="border-collapse text-xs">
                            <thead>
                                <tr>
                                    <th className="p-1" />
                                    {m.riskTitles.map((t, j) => (
                                        <th key={j} className="max-w-16 p-1 text-content-subtle">
                                            <Tooltip content={t}><span className="block max-w-16 truncate">{t.slice(0, 8)}</span></Tooltip>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {m.matrix.map((row, i) => (
                                    <tr key={i}>
                                        <td className="max-w-24 p-1 text-content-subtle">
                                            <Tooltip content={m.riskTitles[i]}><span className="block max-w-24 truncate">{m.riskTitles[i].slice(0, 12)}</span></Tooltip>
                                        </td>
                                        {row.map((v, j) => (
                                            <td
                                                key={j}
                                                className={`border border-border-subtle p-1 text-center tabular-nums ${cellClass(v)} ${j > i ? 'cursor-pointer' : ''}`}
                                                onClick={j > i ? () => { setSel({ i, j }); setCoef(String(v)); } : undefined}
                                            >
                                                {v.toFixed(1)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {sel && (
                        <div className="flex flex-wrap items-end gap-default rounded-md border border-border-emphasis p-default">
                            <span className="text-sm text-content-emphasis">{m.riskTitles[sel.i]} ↔ {m.riskTitles[sel.j]}</span>
                            <label className="block w-24 sm:w-32"><span className="text-xs text-content-muted">{tc('coefficient')}</span>
                                <Input type="text" inputMode="decimal" value={coef} onChange={(e) => setCoef(e.target.value)} />
                            </label>
                            <Button variant="primary" size="sm" onClick={save}>{tc('save')}</Button>
                            <Button variant="ghost" size="sm" onClick={() => setSel(null)}>{tc('cancel')}</Button>
                        </div>
                    )}
                </Card>
            )}

            {suggestions.length > 0 && (
                <Card className="space-y-default p-6">
                    <Heading level={2}>{tc('suggested')}</Heading>
                    <ul className="divide-y divide-border-subtle">
                        {suggestions.map((s) => (
                            <li key={`${s.riskAId}-${s.riskBId}`} className="flex items-center gap-default py-default text-sm">
                                <span className="text-content-muted">{s.reason}</span>
                                <span className="tabular-nums text-content-emphasis">{s.suggestedCoefficient.toFixed(2)}</span>
                                <Button size="sm" variant="secondary" className="ml-auto" onClick={() => applySuggestion(s)}>{tc('apply')}</Button>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}
