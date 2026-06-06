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
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { useTenantMembers } from '@/components/ui/user-combobox';
import dynamic from 'next/dynamic';
import LinkedTasksPanel from '@/components/LinkedTasksPanel';
import { EmptyState } from '@/components/ui/empty-state';
import { CopyText } from '@/components/ui/copy-text';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Pen2 } from '@/components/ui/icons/nucleo';
import { Tooltip } from '@/components/ui/tooltip';
import { type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Eyebrow } from '@/components/ui/typography';
import { AssetCriticalityBadge } from '../_form/AssetCriticalityFields';
import { MetaStrip } from '@/components/ui/meta-strip';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { EditAssetModal } from '../EditAssetModal';
import { InheritedEvidencePanel } from '@/components/InheritedEvidencePanel';
import { AttachedEvidencePanel } from '@/components/AttachedEvidencePanel';
import { Heading } from '@/components/ui/typography';
import { InheritedTestPlansPanel } from '@/components/InheritedTestPlansPanel';
import { InheritedMappingsPanel } from '@/components/InheritedMappingsPanel';

const TraceabilityPanel = dynamic(() => import('@/components/TraceabilityPanel'), {
    loading: () => <SkeletonCard lines={3} />,
    ssr: false,
});

export default function AssetDetailPage() {
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, tenantSlug } = useTenantContext();
    const assetId = params.id as string;

    const [asset, setAsset] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Resolve the "Assigned to" user's display name from the tenant
    // roster so the read view can show a name, not a raw id.
    const { data: members } = useTenantMembers(tenantSlug);
    const assigneeName = asset?.ownerUserId
        ? (members?.find((m) => m.id === asset.ownerUserId)?.name ??
           members?.find((m) => m.id === asset.ownerUserId)?.email ??
           'Assigned')
        : null;

    // B6 +1 — canonical 7-tab strip on every detail page. Same shape
    // as Controls / Risks: Overview holds the existing asset body;
    // Tasks + Traceability are inline-routed to the already-mounted
    // panels; the other four explain where the related-entity surface
    // lives.
    type Tab =
        | 'overview'
        | 'tasks'
        | 'evidence'
        | 'mappings'
        | 'traceability'
        | 'activity'
        | 'tests';
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const tabs: ReadonlyArray<{ key: Tab; label: string }> = [
        { key: 'overview', label: 'Overview' },
        { key: 'tasks', label: 'Tasks' },
        { key: 'evidence', label: 'Evidence' },
        { key: 'mappings', label: 'Mappings' },
        { key: 'traceability', label: 'Traceability' },
        { key: 'activity', label: 'Activity' },
        { key: 'tests', label: 'Tests' },
    ];
    // Modal-form P2 — the inline-edit panel is replaced by an
    // EditAssetModal launched from the detail header. The page URL
    // stays canonical; modal state is purely overlay. Seeding values
    // are computed from the currently-loaded `asset` row at modal
    // open time.
    const [editing, setEditing] = useState(false);
    const editInitial = asset
        ? {
              name: asset.name || '',
              type: asset.type || 'SYSTEM',
              classification: asset.classification || '',
              owner: asset.owner || '',
              ownerUserId: asset.ownerUserId || '',
              location: asset.location || '',
              criticality: asset.criticality || '',
              status: asset.status || 'ACTIVE',
              dataResidency: asset.dataResidency || '',
              externalRef: asset.externalRef || '',
              confidentiality: asset.confidentiality ?? 3,
              integrity: asset.integrity ?? 3,
              availability: asset.availability ?? 3,
          }
        : {};

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
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(k) => setActiveTab(k)}

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
        >
            {error && <div className={cn(cardVariants({ density: 'compact' }), 'border-border-error text-content-error text-sm')}>{error}</div>}

            {/* Edit modal — modal-form P2. Always mounted so the
                modal's own open/close state survives tab switches. */}
            {permissions.canWrite && (
                <EditAssetModal
                    open={editing}
                    setOpen={setEditing}
                    assetId={assetId}
                    initial={editInitial}
                    onSaved={(updated) => setAsset(updated)}
                />
            )}

            {activeTab === 'tasks' && (
                <div className={cardVariants()} id="asset-tasks-tab">
                    <LinkedTasksPanel
                        apiBase={apiUrl('')}
                        entityType="ASSET"
                        entityId={assetId}
                        tenantHref={tenantHref}
                        canWrite={permissions.canWrite}
                    />
                </div>
            )}
            {activeTab === 'traceability' && (
                <TraceabilityPanel
                    apiBase={apiUrl('')}
                    entityType="asset"
                    entityId={assetId}
                    canWrite={permissions.canWrite}
                    tenantHref={tenantHref}
                />
            )}
            {activeTab === 'evidence' && (
                <div className="space-y-section">
                    <div className="space-y-default">
                        <Heading level={3}>Attached evidence</Heading>
                        <AttachedEvidencePanel
                            entityId={assetId}
                            entity="asset"
                            endpoint={`/assets/${assetId}/evidence/attached`}
                            apiUrl={apiUrl}
                            tenantHref={tenantHref}
                            canWrite={permissions.canWrite}
                        />
                    </div>
                    <div className="space-y-default">
                        <Heading level={3}>Inherited from controls</Heading>
                        <InheritedEvidencePanel
                            endpoint={apiUrl(`/assets/${assetId}/evidence`)}
                            tenantHref={tenantHref}
                            entityLabel="asset"
                        />
                    </div>
                </div>
            )}
            {activeTab === 'mappings' && (
                <InheritedMappingsPanel
                    endpoint={apiUrl(`/assets/${assetId}/mappings`)}
                    tenantHref={tenantHref}
                    entityLabel="asset"
                />
            )}
            {activeTab === 'activity' && (
                <EmptyState
                    size="sm"
                    variant="no-records"
                    title="Asset activity log"
                    description="A dedicated activity feed for this asset is on the roadmap. Tenant-wide audit log is available from Admin → Audit Log."
                />
            )}
            {activeTab === 'tests' && (
                <InheritedTestPlansPanel
                    endpoint={apiUrl(`/assets/${assetId}/test-plans`)}
                    tenantHref={tenantHref}
                    entityLabel="asset"
                />
            )}

            {activeTab === 'overview' && (
                <>

            {/* Detail card — read-only view; edits flow through EditAssetModal. */}
            <div className={cn(cardVariants(), 'space-y-default')} id="asset-detail">
                {permissions.canWrite && (
                    <div className="flex justify-end -mt-1 -mb-2">
                        {/* B2 — icon-only edit affordance; opens the Edit
                            Asset modal, mirroring the control overview. */}
                        <Tooltip content="Edit asset">
                            <Button
                                variant="secondary"
                                size="icon"
                                onClick={() => setEditing(true)}
                                id="edit-asset-btn"
                                aria-label="Edit asset"
                            >
                                <Pen2 className="size-4" />
                            </Button>
                        </Tooltip>
                    </div>
                )}
                <>
                        {asset.classification && <div><Eyebrow>Classification</Eyebrow><p className="text-sm">{asset.classification}</p></div>}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                            <div><Eyebrow>Assigned to</Eyebrow><p className="text-sm">{assigneeName || '—'}</p></div>
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
                        <Heading level={3}>Asset Criticality</Heading>
                        <AssetCriticalityBadge
                            confidentiality={asset.confidentiality ?? 3}
                            integrity={asset.integrity ?? 3}
                            availability={asset.availability ?? 3}
                        />
                        <div className="grid grid-cols-2 gap-default border-t border-border-default/50 pt-4">
                            <div><Eyebrow>Created</Eyebrow><p className="text-sm text-content-muted">{formatDate(asset.createdAt)}</p></div>
                            <div><Eyebrow>Updated</Eyebrow><p className="text-sm text-content-muted">{formatDate(asset.updatedAt)}</p></div>
                        </div>
                    </>
            </div>

                </>
            )}
        </EntityDetailLayout>
    );
}
