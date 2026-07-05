'use client';

/* RQ-5 — Risk hierarchy: org trees with recursive ALE roll-up + treemap. */
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { useTenantApiUrl, useTenantHref, useMoneyFormatter } from '@/lib/tenant-context-provider';

interface Agg { nodeId: string; nodeName: string; riskCount: number; totalAle: number; children: Agg[] }
const TYPES = [
    { value: 'BUSINESS_UNIT', labelKey: 'businessUnit' },
    { value: 'GEOGRAPHY', labelKey: 'geography' },
    { value: 'ASSET_CLASS', labelKey: 'assetClass' },
    { value: 'CUSTOM', labelKey: 'custom' },
];
// RQ3-OB-A — money speaks the tenant's currency (useMoneyFormatter).

function TreeRow({ node, depth, max }: { node: Agg; depth: number; max: number }) {
    const money = useMoneyFormatter();
    const th = useTranslations('riskHierarchy');
    return (
        <>
            <div className="flex items-center gap-default py-tight text-sm" style={{ paddingLeft: `${depth * 16}px` }}>
                <span className="w-full sm:w-48 truncate text-content-emphasis">{node.nodeName}</span>
                <div className="flex-1">
                    <ProgressBar value={node.totalAle} max={max || 1} aria-label={th('aleShareAria', { name: node.nodeName })} />
                </div>
                <span className="w-24 sm:w-28 text-right tabular-nums text-content-muted">{money(node.totalAle)}</span>
                <span className="w-16 text-right tabular-nums text-content-subtle">{node.riskCount}</span>
            </div>
            {node.children.map((c) => <TreeRow key={c.nodeId} node={c} depth={depth + 1} max={max} />)}
        </>
    );
}

export default function RiskHierarchyPage() {
    const th = useTranslations('riskHierarchy');
    const apiUrl = useTenantApiUrl();
    const money = useMoneyFormatter();
    const tenantHref = useTenantHref();
    const [type, setType] = useState('BUSINESS_UNIT');
    const [treemap, setTreemap] = useState<Agg[]>([]);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { const r = await fetch(apiUrl(`/risks/hierarchy?type=${type}`)); if (r.ok) setTreemap((await r.json()).treemap); } catch { /* ignore */ }
    }, [apiUrl, type]);
    useEffect(() => { void load(); }, [load]);

    const addNode = async () => {
        if (!name.trim()) return;
        setBusy(true);
        try { await fetch(apiUrl('/risks/hierarchy'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type }) }); setName(''); await load(); }
        finally { setBusy(false); }
    };

    const max = treemap.reduce((m, n) => Math.max(m, n.totalAle), 0);
    const total = treemap.reduce((s, n) => s + n.totalAle, 0);

    return (
        <div className="space-y-section">
            <PageBreadcrumbs items={[{ label: th('risks'), href: tenantHref('/risks') }, { label: th('breadcrumb') }]} />
            <Heading level={1}>{th('title')}</Heading>

            <Card className="space-y-default p-6">
                <div className="flex flex-wrap gap-tight">
                    {TYPES.map((tt) => (
                        <Button key={tt.value} size="sm" variant={type === tt.value ? 'primary' : 'secondary'} onClick={() => setType(tt.value)}>{th(tt.labelKey)}</Button>
                    ))}
                </div>
                <div className="flex flex-wrap items-end gap-default">
                    <label className="block flex-1"><span className="text-xs text-content-muted">{th('newNodeName')}</span>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={th('nodeNamePlaceholder')} />
                    </label>
                    <Button variant="primary" onClick={addNode} disabled={busy || !name.trim()}>{th('addNode')}</Button>
                </div>
            </Card>

            <Card className="space-y-default p-6">
                <div className="flex items-center justify-between">
                    <Heading level={2}>{th('exposureRollup')}</Heading>
                    <span className="text-sm text-content-muted">{th('totalAle', { total: money(total) })}</span>
                </div>
                {treemap.length === 0 ? (
                    <p className="text-sm text-content-muted">{th('noNodes')}</p>
                ) : (
                    <div>
                        <div className="flex items-center gap-default border-b border-border-subtle pb-tight text-xs text-content-subtle">
                            <span className="w-full sm:w-48">{th('colNode')}</span><span className="flex-1">{th('colAleShare')}</span><span className="w-24 sm:w-28 text-right">{th('colTotalAle')}</span><span className="w-16 text-right">{th('colRisks')}</span>
                        </div>
                        {treemap.map((n) => <TreeRow key={n.nodeId} node={n} depth={0} max={max} />)}
                    </div>
                )}
            </Card>
        </div>
    );
}
