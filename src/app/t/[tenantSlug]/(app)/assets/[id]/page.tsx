'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppIcon } from '@/components/icons/AppIcon';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import dynamic from 'next/dynamic';
import LinkedTasksPanel from '@/components/LinkedTasksPanel';
import { CopyText } from '@/components/ui/copy-text';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';

const TraceabilityPanel = dynamic(() => import('@/components/TraceabilityPanel'), {
    loading: () => <div className="animate-pulse h-48" aria-busy="true" />,
    ssr: false,
});

export default function AssetDetailPage() {
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();
    const assetId = params.id as string;

    const [asset, setAsset] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<any>({});

    const fetchAsset = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/assets/${assetId}`));
            if (!res.ok) throw new Error(`Failed to load (${res.status})`);
            const data = await res.json();
            setAsset(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, assetId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchAsset(); }, [fetchAsset]);

    const startEdit = () => {
        if (!asset) return;
        setForm({
            name: asset.name || '',
            type: asset.type || 'SYSTEM',
            classification: asset.classification || '',
            owner: asset.owner || '',
            location: asset.location || '',
            criticality: asset.criticality || '',
            status: asset.status || 'ACTIVE',
            externalRef: asset.externalRef || '',
            confidentiality: asset.confidentiality ?? 3,
            integrity: asset.integrity ?? 3,
            availability: asset.availability ?? 3,
        });
        setEditing(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch(apiUrl(`/assets/${assetId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (!res.ok) throw new Error(`Failed to save (${res.status})`);
            const data = await res.json();
            setAsset(data);
            setEditing(false);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-12 text-center text-content-subtle animate-pulse">Loading asset…</div>;
    if (error && !asset) return <div className="glass-card p-8 text-center text-content-error">{error}<div className="mt-4"><Link href={tenantHref('/assets')} className={buttonVariants({ variant: 'secondary' })}>← Back</Link></div></div>;
    if (!asset) return null;

    const TYPES = ['INFORMATION', 'APPLICATION', 'SYSTEM', 'SERVICE', 'DATA_STORE', 'INFRASTRUCTURE', 'VENDOR', 'PROCESS', 'PEOPLE_PROCESS', 'OTHER'];
    const TYPE_OPTIONS: ComboboxOption[] = TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') }));
    const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH'];
    const CRIT_OPTIONS: ComboboxOption[] = CRITICALITIES.map(c => ({ value: c, label: c }));
    const STATUS_OPTIONS: ComboboxOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'RETIRED', label: 'Retired' }];
    const critColor = (c: string) => c === 'HIGH' ? 'badge-danger' : c === 'MEDIUM' ? 'badge-warning' : 'badge-success';

    return (
        <div className="space-y-6 animate-fadeIn max-w-4xl">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <Link href={tenantHref('/assets')} className="text-content-muted hover:text-content-emphasis transition text-lg">←</Link>
                    <div>
                        <h1 className="text-2xl font-bold" id="asset-title-heading">{asset.name}</h1>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="badge badge-info">{asset.type?.replace(/_/g, ' ')}</span>
                            {asset.criticality && <span className={`badge ${critColor(asset.criticality)}`}>{asset.criticality}</span>}
                            <span className={`badge ${asset.status === 'RETIRED' ? 'badge-neutral' : 'badge-success'}`}>{asset.status || 'ACTIVE'}</span>
                        </div>
                    </div>
                </div>
                {permissions.canWrite && !editing && (
                    <div className="flex gap-2">
                        <Link href={tenantHref(`/risks/ai?assetId=${assetId}`)} className={buttonVariants({ variant: 'secondary' })} id="suggest-risks-btn">Suggest Risks</Link>
                        <Button variant="secondary" onClick={startEdit} id="edit-asset-btn">Edit</Button>
                    </div>
                )}
            </div>

            {error && <div className="glass-card p-4 border-border-error text-content-error text-sm">{error}</div>}

            {/* Detail card */}
            <div className="glass-card p-6 space-y-5" id="asset-detail">
                {editing ? (
                    <>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="input-label">Name *</label><input className="input" value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></div>
                            <div><label className="input-label">Type</label><Combobox hideSearch selected={TYPE_OPTIONS.find(o => o.value === form.type) ?? null} setSelected={(opt) => setForm((f: any) => ({ ...f, type: opt?.value ?? 'SYSTEM' }))} options={TYPE_OPTIONS} matchTriggerWidth /></div>
                            <div><label className="input-label">Criticality</label><Combobox hideSearch selected={CRIT_OPTIONS.find(o => o.value === form.criticality) ?? null} setSelected={(opt) => setForm((f: any) => ({ ...f, criticality: opt?.value || null }))} options={CRIT_OPTIONS} placeholder="—" matchTriggerWidth /></div>
                            <div><label className="input-label">Status</label><Combobox hideSearch selected={STATUS_OPTIONS.find(o => o.value === form.status) ?? null} setSelected={(opt) => setForm((f: any) => ({ ...f, status: opt?.value ?? 'ACTIVE' }))} options={STATUS_OPTIONS} matchTriggerWidth /></div>
                            <div><label className="input-label">Owner</label><input className="input" value={form.owner} onChange={e => setForm((f: any) => ({ ...f, owner: e.target.value }))} /></div>
                            <div><label className="input-label">External Ref</label><input className="input" value={form.externalRef} onChange={e => setForm((f: any) => ({ ...f, externalRef: e.target.value }))} /></div>
                            <div><label className="input-label">Classification</label><input className="input" value={form.classification} onChange={e => setForm((f: any) => ({ ...f, classification: e.target.value }))} /></div>
                            <div><label className="input-label">Location</label><input className="input" value={form.location} onChange={e => setForm((f: any) => ({ ...f, location: e.target.value }))} /></div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button variant="primary" onClick={handleSave} disabled={saving} id="save-asset-btn">{saving ? 'Saving…' : 'Save'}</Button>
                            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                        </div>
                    </>
                ) : (
                    <>
                        {asset.classification && <div><h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">Classification</h3><p className="text-sm">{asset.classification}</p></div>}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div><h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">Owner</h3><p className="text-sm">{asset.owner || '—'}</p></div>
                            <div><h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">Location</h3><p className="text-sm">{asset.location || '—'}</p></div>
                            <div>
                                <h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">External Ref</h3>
                                {asset.externalRef ? (
                                    <CopyText
                                        value={asset.externalRef}
                                        label={`Copy external reference ${asset.externalRef}`}
                                        successMessage="External reference copied"
                                        className="text-sm text-content-default"
                                    >
                                        {asset.externalRef}
                                    </CopyText>
                                ) : (
                                    <p className="text-sm">—</p>
                                )}
                            </div>
                            <div><h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">Data Residency</h3><p className="text-sm">{asset.dataResidency || '—'}</p></div>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="glass-card p-4 text-center"><p className="text-xs text-content-muted uppercase">Confidentiality</p><p className="text-2xl font-bold mt-1">{asset.confidentiality ?? '—'}</p></div>
                            <div className="glass-card p-4 text-center"><p className="text-xs text-content-muted uppercase">Integrity</p><p className="text-2xl font-bold mt-1">{asset.integrity ?? '—'}</p></div>
                            <div className="glass-card p-4 text-center"><p className="text-xs text-content-muted uppercase">Availability</p><p className="text-2xl font-bold mt-1">{asset.availability ?? '—'}</p></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 border-t border-border-default/50 pt-4">
                            <div><h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">Created</h3><p className="text-sm text-content-muted">{formatDate(asset.createdAt)}</p></div>
                            <div><h3 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-1">Updated</h3><p className="text-sm text-content-muted">{formatDate(asset.updatedAt)}</p></div>
                        </div>
                    </>
                )}
            </div>

            {/* Linked Tasks */}
            <div className="glass-card p-6" id="linked-tasks-section">
                <h2 className="text-lg font-semibold text-content-emphasis mb-4 inline-flex items-center gap-2"><AppIcon name="tasks" size={18} /> Linked Tasks</h2>
                <LinkedTasksPanel
                    apiBase={apiUrl('')}
                    entityType="ASSET"
                    entityId={assetId}
                    tenantHref={tenantHref}
                />
            </div>

            {/* Traceability */}
            <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-content-emphasis mb-4 inline-flex items-center gap-2"><AppIcon name="link" size={18} /> Traceability</h2>
                <TraceabilityPanel
                    apiBase={apiUrl('')}
                    entityType="asset"
                    entityId={assetId}
                    canWrite={permissions.canWrite}
                    tenantHref={tenantHref}
                />
            </div>
        </div>
    );
}
