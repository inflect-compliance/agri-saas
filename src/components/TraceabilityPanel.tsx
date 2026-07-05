'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Tanstack-react-table cell callbacks (tanstack cell callbacks where row/getValue carry the implicit-any annotation) — typing each callback with `CellContext<TData, TValue>` requires importing the right generic per column and adds significant ceremony. The implicit any here is at the render-time boundary; row.original is type-narrowed by the column's accessorKey at runtime. */
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AppIcon } from '@/components/icons/AppIcon';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useToastWithUndo } from '@/components/ui/hooks';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface TraceabilityPanelProps {
    apiBase: string;            // e.g. /api/t/acme-corp
    entityType: 'control' | 'risk' | 'asset';
    entityId: string;
    canWrite: boolean;
    tenantHref: (path: string) => string;
    tenantSlug?: string;        // for cache key scoping
}

const RISK_STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    OPEN: 'error', MITIGATING: 'warning', CLOSED: 'success', ACCEPTED: 'info',
};

// Cache key for traceability data
const traceabilityKey = (tenantSlug: string, entityType: string, entityId: string) =>
    ['traceability', tenantSlug, entityType, entityId] as const;

export default function TraceabilityPanel({ apiBase: apiBaseRaw, entityType, entityId, canWrite, tenantHref, tenantSlug: tenantSlugProp }: TraceabilityPanelProps) {
    // Callers pass `apiUrl('')` which yields `/api/t/<slug>/` with a
    // trailing slash. Concatenating `${apiBase}/risks/…` then produces a
    // `//` path which Next.js middleware redirects (308) to the canonical
    // URL — the redirected request drops fetch credentials, and the
    // server-side log shows no traceability call. Strip the trailing
    // slash once so every nested URL is well-formed.
    const t = useTranslations('traceability');
    const apiBase = apiBaseRaw.replace(/\/+$/, '');
    // Extract tenantSlug from apiBase if not provided (e.g. /api/t/acme-corp → acme-corp)
    const tenantSlug = tenantSlugProp || apiBase.split('/t/')[1]?.split('/')[0] || '';
    const queryClient = useQueryClient();
    const triggerUndoToast = useToastWithUndo();

    // Add forms
    const [showAddRisk, setShowAddRisk] = useState(false);
    const [showAddControl, setShowAddControl] = useState(false);
    const [showAddAsset, setShowAddAsset] = useState(false);
    const [addId, setAddId] = useState('');
    const [addRationale, setAddRationale] = useState('');

    // Available items for dropdown

    const [availableRisks, setAvailableRisks] = useState<any[]>([]);

    const [availableControls, setAvailableControls] = useState<any[]>([]);

    const [availableAssets, setAvailableAssets] = useState<any[]>([]);

    const traceUrl = entityType === 'control'
        ? `${apiBase}/controls/${entityId}/traceability`
        : entityType === 'risk'
            ? `${apiBase}/risks/${entityId}/traceability`
            : `${apiBase}/assets/${entityId}/traceability`;

    // ─── Query: traceability data ───
    const traceQuery = useQuery({
        queryKey: traceabilityKey(tenantSlug, entityType, entityId),
        queryFn: async () => {
            const res = await fetch(traceUrl);
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!entityId && !!tenantSlug,
    });

    const data = traceQuery.data;
    const loading = traceQuery.isLoading;

    // Fetch available items when forms open.
    //
    // B1 — `/risks`, `/assets`, `/controls` all return the cap'd
    // `{ rows, truncated }` shape from `applyBackfillCap`. Pre-B1
    // the panel only knew about (a) bare array and (b) the
    // entity-keyed shape `{ risks: [...] }` / etc. — neither
    // matched, so every linking dropdown silently rendered empty.
    // The `unwrap` helper accepts every shape the API has ever
    // returned for these endpoints; new shapes need an explicit
    // entry.
    //
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unwrap = (d: any, entityKey: 'risks' | 'controls' | 'assets'): any[] => {
        if (Array.isArray(d)) return d;
        if (d && Array.isArray(d.rows)) return d.rows;
        if (d && Array.isArray(d[entityKey])) return d[entityKey];
        if (d && Array.isArray(d.items)) return d.items;
        return [];
    };
    useEffect(() => {
        if (showAddRisk) fetch(`${apiBase}/risks`).then(r => r.ok ? r.json() : []).then(d => setAvailableRisks(unwrap(d, 'risks')));
    }, [showAddRisk, apiBase]);
    useEffect(() => {
        if (showAddControl) fetch(`${apiBase}/controls`).then(r => r.ok ? r.json() : []).then(d => setAvailableControls(unwrap(d, 'controls')));
    }, [showAddControl, apiBase]);
    useEffect(() => {
        if (showAddAsset) fetch(`${apiBase}/assets`).then(r => r.ok ? r.json() : []).then(d => setAvailableAssets(unwrap(d, 'assets')));
    }, [showAddAsset, apiBase]);

    // ─── Mutation: link ───
    const linkMutation = useMutation({
        mutationFn: async ({ type, linkedId, rationale }: { type: 'risk' | 'control' | 'asset'; linkedId: string; rationale?: string }) => {
            let url = '';

            let body: any = {};
            if (entityType === 'control' && type === 'risk') {
                url = `${apiBase}/controls/${entityId}/risks`;
                body = { riskId: linkedId, rationale: rationale || undefined };
            } else if (entityType === 'control' && type === 'asset') {
                url = `${apiBase}/assets/${linkedId}/controls`;
                body = { controlId: entityId, rationale: rationale || undefined };
            } else if (entityType === 'risk' && type === 'control') {
                url = `${apiBase}/controls/${linkedId}/risks`;
                body = { riskId: entityId, rationale: rationale || undefined };
            } else if (entityType === 'risk' && type === 'asset') {
                url = `${apiBase}/assets/${linkedId}/risks`;
                body = { riskId: entityId, rationale: rationale || undefined };
            } else if (entityType === 'asset' && type === 'control') {
                url = `${apiBase}/assets/${entityId}/controls`;
                body = { controlId: linkedId, rationale: rationale || undefined };
            } else if (entityType === 'asset' && type === 'risk') {
                url = `${apiBase}/assets/${entityId}/risks`;
                body = { riskId: linkedId, rationale: rationale || undefined };
            }
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!res.ok) throw new Error('Link failed');
            return { type, linkedId };
        },
        onMutate: async ({ type, linkedId, rationale }) => {
            await queryClient.cancelQueries({ queryKey: traceabilityKey(tenantSlug, entityType, entityId) });

            const previous = queryClient.getQueryData<any>(traceabilityKey(tenantSlug, entityType, entityId));

            if (previous) {

                const updated = { ...previous };
                const section = type === 'risk' ? 'risks' : type === 'control' ? 'controls' : 'assets';
                const tempEntry = {
                    id: `temp:${crypto.randomUUID()}`,
                    rationale: rationale || null,
                    [type]: { id: linkedId, title: t('loadingItem'), name: t('loadingItem'), status: '—', code: '' },
                };
                updated[section] = [...(updated[section] || []), tempEntry];
                queryClient.setQueryData(traceabilityKey(tenantSlug, entityType, entityId), updated);
            }

            return { previous };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(traceabilityKey(tenantSlug, entityType, entityId), context.previous);
            }
        },
        onSuccess: (_data, vars) => {
            // Only close the form that was just linked — leaving the
            // other open Link forms intact so a user staging multiple
            // links (e.g. control + risk on an asset) doesn't lose
            // the second form when the first commits.
            setAddId('');
            setAddRationale('');
            if (vars.type === 'risk') setShowAddRisk(false);
            else if (vars.type === 'control') setShowAddControl(false);
            else if (vars.type === 'asset') setShowAddAsset(false);
        },
        onSettled: (_data, _err, vars) => {
            // Invalidate this entity's traceability
            queryClient.invalidateQueries({ queryKey: traceabilityKey(tenantSlug, entityType, entityId) });
            // Cross-invalidate the linked entity's traceability + list
            if (vars) {
                queryClient.invalidateQueries({ queryKey: traceabilityKey(tenantSlug, vars.type, vars.linkedId) });
                if (vars.type === 'control') {
                    queryClient.invalidateQueries({ queryKey: queryKeys.controls.all(tenantSlug) });
                } else if (vars.type === 'risk') {
                    queryClient.invalidateQueries({ queryKey: queryKeys.risks.all(tenantSlug) });
                }
            }
        },
    });

    // ─── Unlink — Epic 67 delayed-commit via useToastWithUndo ───
    //
    // Optimistic removal applies immediately on click via setQueryData
    // so the row visually disappears. The actual DELETE is deferred 5s
    // by the shared hook; clicking Undo restores the snapshot. If the
    // commit fails the snapshot also restores. Cross-entity invalidation
    // runs on commit success, mirroring the pre-Epic-67 mutation's
    // onSettled fan-out.
    const unlinkUrl = (type: 'risk' | 'control' | 'asset', linkedId: string): string => {
        if (entityType === 'control' && type === 'risk') return `${apiBase}/controls/${entityId}/risks/${linkedId}`;
        if (entityType === 'control' && type === 'asset') return `${apiBase}/assets/${linkedId}/controls/${entityId}`;
        if (entityType === 'risk' && type === 'control') return `${apiBase}/controls/${linkedId}/risks/${entityId}`;
        if (entityType === 'risk' && type === 'asset') return `${apiBase}/assets/${linkedId}/risks/${entityId}`;
        if (entityType === 'asset' && type === 'control') return `${apiBase}/assets/${entityId}/controls/${linkedId}`;
        if (entityType === 'asset' && type === 'risk') return `${apiBase}/assets/${entityId}/risks/${linkedId}`;
        return '';
    };

    const UNLINK_LABEL: Record<'risk' | 'control' | 'asset', string> = {
        risk: t('riskUnlinked'),
        control: t('controlUnlinked'),
        asset: t('assetUnlinked'),
    };

    const handleLink = (type: 'risk' | 'control' | 'asset') => {
        if (!addId) return;
        linkMutation.mutate({ type, linkedId: addId, rationale: addRationale || undefined });
    };

    const handleUnlink = (type: 'risk' | 'control' | 'asset', linkedId: string) => {
        const cacheKey = traceabilityKey(tenantSlug, entityType, entityId);
        // Snapshot BEFORE the optimistic write so undo restores exactly
        // what the user saw — not a stale snapshot from before some
        // other concurrent mutation.

        const previous = queryClient.getQueryData<any>(cacheKey);

        if (previous) {
            const updated = { ...previous };
            const section = type === 'risk' ? 'risks' : type === 'control' ? 'controls' : 'assets';

            updated[section] = (updated[section] || []).filter((l: any) => {
                const linked = l[type];
                return linked?.id !== linkedId;
            });
            queryClient.setQueryData(cacheKey, updated);
        }

        triggerUndoToast({
            message: UNLINK_LABEL[type],
            undoMessage: t('undo'),
            action: async () => {
                const url = unlinkUrl(type, linkedId);
                const res = await fetch(url, { method: 'DELETE' });
                if (!res.ok) throw new Error('Unlink failed');
                // Invalidate this entity + the linked entity's mirror
                // view + the entity's parent list so RAG counts on the
                // index pages stay correct after a commit.
                queryClient.invalidateQueries({ queryKey: cacheKey });
                queryClient.invalidateQueries({ queryKey: traceabilityKey(tenantSlug, type, linkedId) });
                if (type === 'control') {
                    queryClient.invalidateQueries({ queryKey: queryKeys.controls.all(tenantSlug) });
                } else if (type === 'risk') {
                    queryClient.invalidateQueries({ queryKey: queryKeys.risks.all(tenantSlug) });
                }
            },
            undoAction: () => {
                if (previous) queryClient.setQueryData(cacheKey, previous);
            },
            onError: () => {
                if (previous) queryClient.setQueryData(cacheKey, previous);
            },
        });
    };

    if (loading) return <div className="p-6 text-center text-content-subtle animate-pulse">{t('loading')}</div>;
    if (!data) return <div className="p-6 text-center text-content-subtle">{t('loadFailed')}</div>;

    const risks = data.risks || [];
    const controls = data.controls || [];
    const assets = data.assets || [];

    // Determine which sections to show based on entity type
    const showRisks = entityType === 'control' || entityType === 'asset';
    const showControls = entityType === 'risk' || entityType === 'asset';
    const showAssets = entityType === 'control' || entityType === 'risk';

    return (
        <div className="space-y-section" id="traceability-panel">
            {/* Risks section */}
            {showRisks && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <Heading level={3} className="text-content-emphasis inline-flex items-center gap-tight">{entityType === 'control' ? <><AppIcon name="shield" size={16} /> {t('mitigatesRisks')}</> : <><AppIcon name="warning" size={16} /> {t('associatedRisks')}</>} ({risks.length})</Heading>
                        {canWrite && (
                            <Button variant="primary" size="xs" onClick={() => { setShowAddRisk(!showAddRisk); setAddId(''); }} id="add-risk-link-btn">{t('linkRisk')}</Button>
                        )}
                    </div>
                    {showAddRisk && canWrite && (
                        <div className={cn(cardVariants({ density: 'compact' }), 'mb-3 space-y-tight')}>
                            <Combobox
                                id="risk-select"
                                selected={availableRisks.map((r: any) => ({ value: r.id, label: r.title, meta: { status: r.status } })).find((o: { value: string }) => o.value === addId) ?? null}
                                setSelected={(opt) => setAddId(opt?.value ?? '')}
                                options={availableRisks.map((r: any) => ({ value: r.id, label: r.title, meta: { status: r.status } }))}
                                optionDescription={(o) => (o.meta?.status ? t('statusMeta', { status: o.meta.status }) : null)}
                                placeholder={t('selectRisk')}
                                matchTriggerWidth
                            />
                            <input type="text" className="input w-full text-sm" placeholder={t('rationalePlaceholder')} value={addRationale} onChange={e => setAddRationale(e.target.value)} />
                            <Button variant="primary" size="xs" disabled={!addId || linkMutation.isPending} onClick={() => handleLink('risk')} id="confirm-risk-link">
                                {linkMutation.isPending ? t('linking') : t('link')}
                            </Button>
                        </div>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                        {risks.length === 0 ? (
                            <div className="p-6 text-center text-content-subtle text-sm" id="no-risks">{t('noRisksLinked')}</div>
                        ) : (
                            <table className="data-table" id="linked-risks-table">
                                <thead><tr><th>{t('colRisk')}</th><th>{t('colStatus')}</th><th>{t('colScore')}</th><th>{t('colRationale')}</th>{canWrite && <th>{t('colActions')}</th>}</tr></thead>
                                <tbody>
                                    { }
                                    {risks.map((l: any) => {
                                        const r = l.risk;
                                        return (
                                            <tr key={l.id} className={l.id?.startsWith('temp:') ? 'opacity-50 animate-pulse' : ''}>
                                                <td className="text-sm text-content-default">{r?.title || '—'}</td>
                                                <td><StatusBadge variant={RISK_STATUS_BADGE[r?.status] || 'neutral'}>{r?.status || '—'}</StatusBadge></td>
                                                <td className="text-sm text-content-emphasis font-medium">{r?.score ?? '—'}</td>
                                                <td className="text-xs text-content-muted">{l.rationale || '—'}</td>
                                                {canWrite && (
                                                    <td>
                                                        <Tooltip content={t('unlinkRisk')}>
                                                            <button className="text-content-error text-xs hover:text-content-error" onClick={() => handleUnlink('risk', r?.id)} id={`unlink-risk-${r?.id}`} aria-label={t('unlinkRisk')}>×</button>
                                                        </Tooltip>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* Controls section */}
            {showControls && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <Heading level={3} className="text-content-emphasis inline-flex items-center gap-tight">{entityType === 'risk' ? <><AppIcon name="shield" size={16} /> {t('mitigatedByControls')}</> : <><AppIcon name="controls" size={16} /> {t('coveredByControls')}</>} ({controls.length})</Heading>
                        {canWrite && (
                            <Button variant="primary" size="xs" onClick={() => { setShowAddControl(!showAddControl); setAddId(''); }} id="add-control-link-btn">{t('linkControl')}</Button>
                        )}
                    </div>
                    {showAddControl && canWrite && (
                        <div className={cn(cardVariants({ density: 'compact' }), 'mb-3 space-y-tight')}>
                            <Combobox
                                id="control-select"
                                selected={availableControls.map((c: any) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name, meta: { status: c.status } })).find((o: { value: string }) => o.value === addId) ?? null}
                                setSelected={(opt) => setAddId(opt?.value ?? '')}
                                options={availableControls.map((c: any) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name, meta: { status: c.status } }))}
                                optionDescription={(o) => (o.meta?.status ? t('statusMeta', { status: o.meta.status }) : null)}
                                placeholder={t('selectControl')}
                                matchTriggerWidth
                            />
                            <input type="text" className="input w-full text-sm" placeholder={t('rationalePlaceholder')} value={addRationale} onChange={e => setAddRationale(e.target.value)} />
                            <Button variant="primary" size="xs" disabled={!addId || linkMutation.isPending} onClick={() => handleLink('control')} id="confirm-control-link">
                                {linkMutation.isPending ? t('linking') : t('link')}
                            </Button>
                        </div>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                        {controls.length === 0 ? (
                            <div className="p-6 text-center text-content-subtle text-sm" id="no-controls">{t('noControlsLinked')}</div>
                        ) : (
                            <table className="data-table" id="linked-controls-table">
                                <thead><tr><th>{t('colCode')}</th><th>{t('colName')}</th><th>{t('colStatus')}</th><th>{t('colRationale')}</th>{canWrite && <th>{t('colActions')}</th>}</tr></thead>
                                <tbody>
                                    { }
                                    {controls.map((l: any) => {
                                        const c = l.control;
                                        return (
                                            <tr key={l.id} className={l.id?.startsWith('temp:') ? 'opacity-50 animate-pulse' : ''}>
                                                <td className="font-mono text-xs text-[var(--brand-muted)]">{c?.code || '—'}</td>
                                                <td className="text-sm text-content-default">{c?.name || '—'}</td>
                                                <td><StatusBadge variant="info">{c?.status || '—'}</StatusBadge></td>
                                                <td className="text-xs text-content-muted">{l.rationale || '—'}</td>
                                                {canWrite && (
                                                    <td>
                                                        <Tooltip content={t('unlinkControl')}>
                                                            <button className="text-content-error text-xs hover:text-content-error" onClick={() => handleUnlink('control', c?.id)} id={`unlink-control-${c?.id}`} aria-label={t('unlinkControl')}>×</button>
                                                        </Tooltip>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* Assets section */}
            {showAssets && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <Heading level={3} className="text-content-emphasis inline-flex items-center gap-tight"><AppIcon name="package" size={16} /> {entityType === 'control' ? t('coversAssets') : t('affectsAssets')} ({assets.length})</Heading>
                        {canWrite && (
                            <Button variant="primary" size="xs" onClick={() => { setShowAddAsset(!showAddAsset); setAddId(''); }} id="add-asset-link-btn">{t('linkAsset')}</Button>
                        )}
                    </div>
                    {showAddAsset && canWrite && (
                        <div className={cn(cardVariants({ density: 'compact' }), 'mb-3 space-y-tight')}>
                            <Combobox
                                id="asset-select"
                                selected={availableAssets.map((a: any) => ({ value: a.id, label: a.name, meta: { type: a.type } })).find((o: { value: string }) => o.value === addId) ?? null}
                                setSelected={(opt) => setAddId(opt?.value ?? '')}
                                options={availableAssets.map((a: any) => ({ value: a.id, label: a.name, meta: { type: a.type } }))}
                                optionDescription={(o) => (o.meta?.type ? t('typeMeta', { type: o.meta.type }) : null)}
                                placeholder={t('selectAsset')}
                                matchTriggerWidth
                            />
                            <input type="text" className="input w-full text-sm" placeholder={t('rationalePlaceholder')} value={addRationale} onChange={e => setAddRationale(e.target.value)} />
                            <Button variant="primary" size="xs" disabled={!addId || linkMutation.isPending} onClick={() => handleLink('asset')} id="confirm-asset-link">
                                {linkMutation.isPending ? t('linking') : t('link')}
                            </Button>
                        </div>
                    )}
                    <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                        {assets.length === 0 ? (
                            <div className="p-6 text-center text-content-subtle text-sm" id="no-assets">{t('noAssetsLinked')}</div>
                        ) : (
                            <table className="data-table" id="linked-assets-table">
                                <thead><tr><th>{t('colName')}</th><th>{t('colType')}</th><th>{t('colCriticality')}</th><th>{t('colRationale')}</th>{canWrite && <th>{t('colActions')}</th>}</tr></thead>
                                <tbody>
                                    { }
                                    {assets.map((l: any) => {
                                        const a = l.asset;
                                        return (
                                            <tr key={l.id} className={l.id?.startsWith('temp:') ? 'opacity-50 animate-pulse' : ''}>
                                                <td className="text-sm text-content-default">{a?.name || '—'}</td>
                                                <td className="text-xs"><StatusBadge variant="info">{a?.type || '—'}</StatusBadge></td>
                                                <td className="text-xs">{a?.criticality ? <StatusBadge variant={a.criticality === 'HIGH' ? 'error' : a.criticality === 'MEDIUM' ? 'warning' : 'neutral'}>{a.criticality}</StatusBadge> : '—'}</td>
                                                <td className="text-xs text-content-muted">{l.rationale || '—'}</td>
                                                {canWrite && (
                                                    <td>
                                                        <Tooltip content={t('unlinkAsset')}>
                                                            <button className="text-content-error text-xs hover:text-content-error" onClick={() => handleUnlink('asset', a?.id)} id={`unlink-asset-${a?.id}`} aria-label={t('unlinkAsset')}>×</button>
                                                        </Tooltip>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
