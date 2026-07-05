'use client';

/* RQ-6 — Key Risk Indicators: RAG cards + sparkline + record reading. */
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';

interface Kri {
    id: string; name: string; unit: string | null; direction: string; greenMax: number | null; amberMax: number | null;
    frequency: string; targetValue: number | null; isActive: boolean;
    /** RQ3-7 — the linked risk (null = orphaned KRI). Drives the deep-link. */
    riskId: string | null;
    latestReading: { value: number; ragStatus: string | null } | null; sparkline: number[];
}
const SPARK = '▁▂▃▄▅▆▇█';
function sparkline(values: number[]): string {
    if (values.length === 0) return '—';
    const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
    return values.map((v) => SPARK[Math.min(SPARK.length - 1, Math.floor(((v - min) / span) * (SPARK.length - 1)))]).join('');
}
const ragVariant = (r: string | null | undefined) => (r === 'RED' ? 'error' : r === 'AMBER' ? 'warning' : 'success');

export default function KriPage() {
    const tk = useTranslations('riskKri');
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const [kris, setKris] = useState<Kri[]>([]);
    const [name, setName] = useState('');
    const [greenMax, setGreenMax] = useState('');
    const [amberMax, setAmberMax] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { const r = await fetch(apiUrl('/risks/kri')); if (r.ok) setKris((await r.json()).kris); } catch { /* ignore */ }
    }, [apiUrl]);
    useEffect(() => { void load(); }, [load]);

    const create = async () => {
        if (!name.trim()) return;
        setBusy(true);
        try {
            await fetch(apiUrl('/risks/kri'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), greenMax: greenMax.trim() ? Number(greenMax) : null, amberMax: amberMax.trim() ? Number(amberMax) : null }),
            });
            setName(''); setGreenMax(''); setAmberMax(''); await load();
        } finally { setBusy(false); }
    };

    const record = async (kriId: string, raw: string) => {
        const value = Number(raw);
        if (!isFinite(value)) return;
        await fetch(apiUrl(`/risks/kri/${kriId}/readings`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
        await load();
    };

    return (
        <div className="space-y-section">
            <PageBreadcrumbs items={[{ label: tk('risks'), href: tenantHref('/risks') }, { label: tk('breadcrumb') }]} />
            <Heading level={1}>{tk('title')}</Heading>

            <Card className="space-y-default p-6">
                <Heading level={2}>{tk('newKri')}</Heading>
                <div className="flex flex-wrap items-end gap-default">
                    <label className="block flex-1"><span className="text-xs text-content-muted">{tk('name')}</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tk('namePlaceholder')} /></label>
                    <label className="block w-24 sm:w-32"><span className="text-xs text-content-muted">{tk('greenMax')}</span><Input type="text" inputMode="decimal" value={greenMax} onChange={(e) => setGreenMax(e.target.value)} /></label>
                    <label className="block w-24 sm:w-32"><span className="text-xs text-content-muted">{tk('amberMax')}</span><Input type="text" inputMode="decimal" value={amberMax} onChange={(e) => setAmberMax(e.target.value)} /></label>
                    <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>{tk('create')}</Button>
                </div>
            </Card>

            {kris.length === 0 ? (
                <Card className="p-6"><p className="text-sm text-content-muted">{tk('noKris')}</p></Card>
            ) : (
                <div className="grid grid-cols-1 gap-default md:grid-cols-2">
                    {kris.map((k) => (
                        <Card key={k.id} className="space-y-tight p-6" data-testid="kri-card">
                            <div className="flex items-center justify-between gap-default">
                                <Heading level={3}>{k.name}</Heading>
                                <StatusBadge variant={ragVariant(k.latestReading?.ragStatus)}>
                                    {k.latestReading?.ragStatus ?? tk('noData')}{k.latestReading != null ? ` · ${k.latestReading.value}${k.unit ?? ''}` : ''}
                                </StatusBadge>
                            </div>
                            <div className="font-mono text-lg leading-none text-content-emphasis" aria-label={tk('readingTrend')}>{sparkline(k.sparkline)}</div>
                            <p className="text-xs text-content-muted">
                                {k.targetValue != null ? tk('targetLine', { target: `${k.targetValue}${k.unit ?? ''}` }) : ''}{tk('thresholdsLine', { frequency: k.frequency.toLowerCase(), green: k.greenMax ?? '—', amber: k.amberMax ?? '—' })}
                            </p>
                            {/* RQ3-7 — when a KRI is breached (RED) and
                                linked to a risk, deep-link straight to
                                that risk's Assessment tab. Closes the
                                sensor → belief loop: the breach is one
                                click from the re-assessment it should
                                trigger. */}
                            {k.riskId && k.latestReading?.ragStatus === 'RED' && (
                                <Link
                                    href={tenantHref(`/risks/${k.riskId}?tab=assessment`)}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-content-error underline underline-offset-2"
                                    data-testid={`kri-reassess-link-${k.id}`}
                                >
                                    {tk('reassessLink')}
                                </Link>
                            )}
                            <RecordInline onRecord={(v) => record(k.id, v)} />
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

function RecordInline({ onRecord }: { onRecord: (v: string) => void }) {
    const tk = useTranslations('riskKri');
    const [v, setV] = useState('');
    return (
        <div className="flex items-end gap-tight">
            <label className="block flex-1"><span className="text-xs text-content-muted">{tk('recordReading')}</span>
                <Input type="text" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={tk('valuePlaceholder')} />
            </label>
            <Button size="sm" variant="secondary" onClick={() => { onRecord(v); setV(''); }} disabled={!v.trim()}>{tk('add')}</Button>
        </div>
    );
}
