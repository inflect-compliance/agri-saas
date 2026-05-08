'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppIcon, type AppIconName } from '@/components/icons/AppIcon';
import { Button } from '@/components/ui/button';

const FW_META: Record<string, { icon: AppIconName; label: string }> = {
    ISO27001: { icon: 'shield', label: 'ISO/IEC 27001:2022' },
    NIS2: { icon: 'globe', label: 'NIS2 Directive' },
};

export default function CycleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const tenantSlug = params.tenantSlug as string;
    const cycleId = params.cycleId as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);

    const [cycle, setCycle] = useState<any>(null);
    const [preview, setPreview] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        Promise.all([
            fetch(apiUrl(`/audits/cycles/${cycleId}`)).then(r => r.ok ? r.json() : null),
            fetch(apiUrl(`/audits/cycles/${cycleId}?action=default-pack-preview`)).then(r => r.ok ? r.json() : null),
        ]).then(([c, p]) => { setCycle(c); setPreview(p); }).finally(() => setLoading(false));
    }, [apiUrl, cycleId]);

    const createDefaultPack = async () => {
        setCreating(true);
        try {
            // 1) Create pack
            const packRes = await fetch(apiUrl('/audits/packs'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auditCycleId: cycleId, name: `${cycle.frameworkKey} Default Pack` }),
            });
            if (!packRes.ok) { setCreating(false); return; }
            const pack = await packRes.json();

            // 2) Add all items from preview
            if (preview?.selection) {
                const items: any[] = [];
                const sel = preview.selection;
                sel.controls?.ids?.forEach((id: string, i: number) => items.push({ entityType: 'CONTROL', entityId: id, sortOrder: i }));
                sel.policies?.ids?.forEach((id: string, i: number) => items.push({ entityType: 'POLICY', entityId: id, sortOrder: 100 + i }));
                sel.evidence?.ids?.forEach((id: string, i: number) => items.push({ entityType: 'EVIDENCE', entityId: id, sortOrder: 200 + i }));
                sel.issues?.ids?.forEach((id: string, i: number) => items.push({ entityType: 'ISSUE', entityId: id, sortOrder: 300 + i }));

                if (items.length > 0) {
                    await fetch(apiUrl(`/audits/packs/${pack.id}?action=items`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ items }),
                    });
                }
            }
            router.push(`/t/${tenantSlug}/audits/packs/${pack.id}`);
        } finally { setCreating(false); }
    };

    if (loading) return <div className="p-8"><div className="glass-card animate-pulse h-64" /></div>;
    if (!cycle) return <div className="p-8 text-center text-content-muted">Audit cycle not found</div>;

    const meta = FW_META[cycle.frameworkKey] || { icon: 'shield' as AppIconName, label: cycle.frameworkKey };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center gap-3">
                <Link href={`/t/${tenantSlug}/audits/cycles`} className="text-content-muted hover:text-content-emphasis transition">← Cycles</Link>
            </div>

            <div className="glass-card p-6">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div><AppIcon name={meta.icon} size={32} /></div>
                        <div>
                            <h1 className="text-xl font-bold" id="cycle-name">{cycle.name}</h1>
                            <p className="text-sm text-content-muted">{meta.label} · v{cycle.frameworkVersion} · {cycle.status}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Default Pack Preview */}
            <div className="glass-card p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Default Pack Preview</h2>
                    <Button variant="primary" onClick={createDefaultPack} disabled={creating} id="create-default-pack-btn" icon={<AppIcon name="package" size={16} />}>
                        {creating ? 'Creating...' : 'Create Pack from Default Selection'}
                    </Button>
                </div>

                {preview ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="preview-counts">
                        <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                            <div className="text-2xl font-bold text-indigo-400" id="preview-controls">{preview.selection?.controls?.count || 0}</div>
                            <div className="text-xs text-content-muted">Controls</div>
                        </div>
                        <div className="p-4 rounded-lg bg-bg-info border border-border-info">
                            <div className="text-2xl font-bold text-content-info" id="preview-policies">{preview.selection?.policies?.count || 0}</div>
                            <div className="text-xs text-content-muted">Policies</div>
                        </div>
                        <div className="p-4 rounded-lg bg-bg-success border border-border-success">
                            <div className="text-2xl font-bold text-content-success" id="preview-evidence">{preview.selection?.evidence?.count || 0}</div>
                            <div className="text-xs text-content-muted">Evidence</div>
                        </div>
                        <div className="p-4 rounded-lg bg-bg-warning border border-border-warning">
                            <div className="text-2xl font-bold text-content-warning" id="preview-issues">{preview.selection?.issues?.count || 0}</div>
                            <div className="text-xs text-content-muted">Issues</div>
                        </div>
                    </div>
                ) : (
                    <p className="text-content-muted text-sm">Could not load default pack preview.</p>
                )}

                <p className="text-xs text-content-subtle">
                    Total: {preview?.totalItems || 0} items will be included in the default pack.
                </p>
            </div>

            {/* Existing Packs */}
            {cycle.packs?.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold">Packs</h2>
                    {cycle.packs.map((p: any) => (
                        <Link key={p.id} href={`/t/${tenantSlug}/audits/packs/${p.id}`}
                            className="glass-card p-4 flex items-center justify-between hover:bg-bg-elevated/30 transition block" id={`pack-link-${p.id}`}>
                            <div>
                                <span className="font-medium text-sm">{p.name}</span>
                                <span className={`badge ml-2 ${p.status === 'DRAFT' ? 'badge-neutral' : p.status === 'FROZEN' ? 'badge-info' : 'badge-success'}`}>{p.status}</span>
                            </div>
                            <span className="text-xs text-content-subtle">→</span>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
