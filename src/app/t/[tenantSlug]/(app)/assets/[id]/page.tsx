'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';
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
import { type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading, Eyebrow } from '@/components/ui/typography';
import { KPIStat } from '@/components/ui/metric';
import { MetaStrip } from '@/components/ui/meta-strip';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@dub/utils';

const TraceabilityPanel = dynamic(() => import('@/components/TraceabilityPanel'), {
    loading: () => <SkeletonCard lines={3} />,
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

    const TYPES = ['INFORMATION', 'APPLICATION', 'SYSTEM', 'SERVICE', 'DATA_STORE', 'INFRASTRUCTURE', 'VENDOR', 'PROCESS', 'PEOPLE_PROCESS', 'OTHER'];
    const TYPE_OPTIONS: ComboboxOption[] = TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') }));
    const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH'];
    const CRIT_OPTIONS: ComboboxOption[] = CRITICALITIES.map(c => ({ value: c, label: c }));
    const STATUS_OPTIONS: ComboboxOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'RETIRED', label: 'Retired' }];
    const critColor = (c: string): StatusBadgeVariant => c === 'HIGH' ? 'error' : c === 'MEDIUM' ? 'warning' : 'success';

    const breadcrumbs = [
        { label: 'Dashboard', href: tenantHref('/dashboard') },
        { label: 'Assets', href: tenantHref('/assets') },
        { label: asset?.name ?? 'Asset' },
    ];
    if (loading) {
        return (
            <EntityDetailLayout loading title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (error && !asset) {
        return (
            <EntityDetailLayout error={error} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (!asset) {
        return (
            <EntityDetailLayout empty={{ message: 'Asset not found.' }} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }

    return (
        <EntityDetailLayout
            id="asset-detail-page"
            breadcrumbs={breadcrumbs}

            title={<span id="asset-title-heading">{asset.name}</span>}
            meta={
                <MetaStrip
                    items={[
                        {
                            label: 'Type',
                            value: asset.type?.replace(/_/g, ' '),
                        },
                        ...(asset.criticality
                            ? [
                                  {
                                      kind: 'status' as const,
                                      label: 'Criticality',
                                      value: asset.criticality,
                                      variant: critColor(asset.criticality),
                                  },
                              ]
                            : []),
                        {
                            kind: 'status' as const,
                            label: 'Status',
                            value: asset.status || 'ACTIVE',
                            variant:
                                asset.status === 'RETIRED'
                                    ? 'neutral'
                                    : 'success',
                        },
                    ]}
                />
            }
            actions={
                permissions.canWrite && !editing && (
                    <>
                        <Link href={tenantHref(`/risks/ai?assetId=${assetId}`)} className={buttonVariants({ variant: 'secondary' })} id="suggest-risks-btn">Suggest Risks</Link>
                        <Button variant="secondary" onClick={startEdit} id="edit-asset-btn">Edit</Button>
                    </>
                )
            }
        >
            {error && <div className={cn(cardVariants({ density: 'compact' }), 'border-border-error text-content-error text-sm')}>{error}</div>}

            {/* Detail card */}
            <div className={cn(cardVariants(), 'space-y-default')} id="asset-detail">
                {editing ? (
                    <>
                        <div className="grid grid-cols-2 gap-default">
                            <div><label className="input-label">Name *</label><input className="input" value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></div>
                            <div><label className="input-label">Type</label><Combobox hideSearch selected={TYPE_OPTIONS.find(o => o.value === form.type) ?? null} setSelected={(opt) => setForm((f: any) => ({ ...f, type: opt?.value ?? 'SYSTEM' }))} options={TYPE_OPTIONS} matchTriggerWidth /></div>
                            <div><label className="input-label">Criticality</label><Combobox hideSearch selected={CRIT_OPTIONS.find(o => o.value === form.criticality) ?? null} setSelected={(opt) => setForm((f: any) => ({ ...f, criticality: opt?.value || null }))} options={CRIT_OPTIONS} placeholder="—" matchTriggerWidth /></div>
                            <div><label className="input-label">Status</label><Combobox hideSearch selected={STATUS_OPTIONS.find(o => o.value === form.status) ?? null} setSelected={(opt) => setForm((f: any) => ({ ...f, status: opt?.value ?? 'ACTIVE' }))} options={STATUS_OPTIONS} matchTriggerWidth /></div>
                            <div><label className="input-label">Owner</label><input className="input" value={form.owner} onChange={e => setForm((f: any) => ({ ...f, owner: e.target.value }))} /></div>
                            <div><label className="input-label">External Ref</label><input className="input" value={form.externalRef} onChange={e => setForm((f: any) => ({ ...f, externalRef: e.target.value }))} /></div>
                            <div><label className="input-label">Classification</label><input className="input" value={form.classification} onChange={e => setForm((f: any) => ({ ...f, classification: e.target.value }))} /></div>
                            <div><label className="input-label">Location</label><input className="input" value={form.location} onChange={e => setForm((f: any) => ({ ...f, location: e.target.value }))} /></div>
                        </div>
                        <div className="flex gap-compact pt-2">
                            <Button variant="primary" onClick={handleSave} disabled={saving} id="save-asset-btn">{saving ? 'Saving…' : 'Save'}</Button>
                            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                        </div>
                    </>
                ) : (
                    <>
                        {asset.classification && <div><Eyebrow>Classification</Eyebrow><p className="text-sm">{asset.classification}</p></div>}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                            <div><Eyebrow>Owner</Eyebrow><p className="text-sm">{asset.owner || '—'}</p></div>
                            <div><Eyebrow>Location</Eyebrow><p className="text-sm">{asset.location || '—'}</p></div>
                            <div>
                                <Eyebrow>External Ref</Eyebrow>
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
                            <div><Eyebrow>Data Residency</Eyebrow><p className="text-sm">{asset.dataResidency || '—'}</p></div>
                        </div>
                        <div className="grid grid-cols-3 gap-default">
                            <div className={cardVariants({ density: 'compact' })}>
                                <KPIStat value={asset.confidentiality ?? '—'} label="Confidentiality" size="sm" />
                            </div>
                            <div className={cardVariants({ density: 'compact' })}>
                                <KPIStat value={asset.integrity ?? '—'} label="Integrity" size="sm" />
                            </div>
                            <div className={cardVariants({ density: 'compact' })}>
                                <KPIStat value={asset.availability ?? '—'} label="Availability" size="sm" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-default border-t border-border-default/50 pt-4">
                            <div><Eyebrow>Created</Eyebrow><p className="text-sm text-content-muted">{formatDate(asset.createdAt)}</p></div>
                            <div><Eyebrow>Updated</Eyebrow><p className="text-sm text-content-muted">{formatDate(asset.updatedAt)}</p></div>
                        </div>
                    </>
                )}
            </div>

            {/* Linked Tasks */}
            <div className={cardVariants()} id="linked-tasks-section">
                <Heading level={2} className="mb-4 inline-flex items-center gap-tight"><AppIcon name="tasks" size={18} /> Linked Tasks</Heading>
                <LinkedTasksPanel
                    apiBase={apiUrl('')}
                    entityType="ASSET"
                    entityId={assetId}
                    tenantHref={tenantHref}
                />
            </div>

            {/* Traceability */}
            <div className={cardVariants()}>
                <Heading level={2} className="mb-4 inline-flex items-center gap-tight"><AppIcon name="link" size={18} /> Traceability</Heading>
                <TraceabilityPanel
                    apiBase={apiUrl('')}
                    entityType="asset"
                    entityId={assetId}
                    canWrite={permissions.canWrite}
                    tenantHref={tenantHref}
                />
            </div>
        </EntityDetailLayout>
    );
}
