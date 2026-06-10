'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTenantContext, useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import dynamic from 'next/dynamic';
import LinkedTasksPanel from '@/components/LinkedTasksPanel';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/typography';
import { KPIStat } from '@/components/ui/metric';
import { MetaStrip } from '@/components/ui/meta-strip';
import {
    RISK_STATUS_VARIANT,
    getRiskScoreBand,
} from '@/app-layer/domain/entity-status-mapping';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
// Epic G-7 — treatment plan card. Dynamic-imported so the modal +
// react-query machinery only loads on risks the user actually opens.
const RiskTreatmentPlanCard = dynamic(
    () =>
        import('@/components/RiskTreatmentPlanCard').then(
            (m) => m.RiskTreatmentPlanCard,
        ),
    {
        loading: () => (
            <SkeletonCard lines={2} />
        ),
        ssr: false,
    },
);
import { Button } from '@/components/ui/button';
import { Pen2 } from '@/components/ui/icons/nucleo';
import { Tooltip } from '@/components/ui/tooltip';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { useTenantMembers } from '@/components/ui/user-combobox';
import { RISK_TREATMENT_OPTIONS } from '../_shared/risk-options';
import { cn } from '@/lib/cn';
import { cardVariants } from '@/components/ui/card';
import { EditRiskModal, type EditRiskForm } from './_modals/EditRiskModal';
import { FairAnalysisPanel } from './FairAnalysisPanel';
import { BowTiePanel } from './BowTiePanel';
import { RiskHistoryPanel } from './RiskHistoryPanel';
import { InheritedEvidencePanel } from '@/components/InheritedEvidencePanel';
import { AttachedEvidencePanel } from '@/components/AttachedEvidencePanel';
import { Heading } from '@/components/ui/typography';
import { InheritedTestPlansPanel } from '@/components/InheritedTestPlansPanel';
import { InheritedMappingsPanel } from '@/components/InheritedMappingsPanel';

const TraceabilityPanel = dynamic(() => import('@/components/TraceabilityPanel'), {
    loading: () => <SkeletonCard lines={3} />,
    ssr: false,
});

type Risk = {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    threat: string | null;
    vulnerability: string | null;
    status: string;
    treatment: string | null;
    treatmentOwner: string | null;
    treatmentNotes: string | null;
    ownerUserId: string | null;
    likelihood: number;
    impact: number;
    score: number;
    inherentScore: number;
    nextReviewAt: string | null;
    targetDate: string | null;
    createdAt: string;
    updatedAt: string;
    // RQ-1 FAIR inputs (all nullable).
    threatEventFrequency: number | null;
    contactFrequency: number | null;
    probabilityOfAction: number | null;
    vulnerabilityProbability: number | null;
    threatCapability: number | null;
    controlStrength: number | null;
    primaryLossMagnitude: number | null;
    productivityLoss: number | null;
    responseCost: number | null;
    replacementCost: number | null;
    secondaryLossEventFrequency: number | null;
    secondaryLossMagnitude: number | null;
    fairConfidence: 'LOW' | 'MEDIUM' | 'HIGH' | null;
    fairAle: number | null;
};

// Audit Coherence S1 — MITIGATED sits between MITIGATING and
// ACCEPTED in the RiskStatus enum. The detail-page status combobox
// must offer it; otherwise a reviewer who picks "Mitigated" in the
// list filter cannot land on the corresponding detail-page value.
const STATUS_VALUES = [
    'OPEN',
    'MITIGATING',
    'MITIGATED',
    'ACCEPTED',
    'CLOSED',
] as const;
const STATUS_OPTIONS: ComboboxOption[] = STATUS_VALUES.map(s => ({ value: s, label: s }));
const CATEGORIES = [
    'Technical', 'Operational', 'Compliance', 'Strategic',
    'Financial', 'Reputational', 'Physical', 'Human Resources',
];
const CATEGORY_OPTIONS: ComboboxOption[] = CATEGORIES.map(c => ({ value: c, label: c }));
const TREATMENT_OPTIONS = RISK_TREATMENT_OPTIONS;

// Polish PR-1 — STATUS_VARIANT moved to shared domain mapping.
// Imported from @/app-layer/domain/entity-status-mapping as
// `RISK_STATUS_VARIANT` so risks list / dashboard / detail all read
// the same vocabulary.

function isOverdue(nextReviewAt: string | null): boolean {
    if (!nextReviewAt) return false;
    return new Date(nextReviewAt) < new Date();
}

// getRiskBadge → getRiskScoreBand from shared domain mapping.

export default function RiskDetailPage() {
    const { riskId } = useParams<{ riskId: string }>();
    const tenant = useTenantContext();
    const apiUrl = useTenantApiUrl();
    const href = useTenantHref();
    const canWrite = tenant.permissions.canWrite;
    const { data: riskMembers } = useTenantMembers(tenant.tenantSlug);

    const [risk, setRisk] = useState<Risk | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    // B6 +1 — every detail page wears the canonical 7-tab strip
    // first introduced on the Controls detail surface. Overview holds
    // the existing risk body; the other six are inline-routed to the
    // already-mounted panels or stubbed with an EmptyState that
    // explains where the related-entity surface lives.
    type Tab =
        | 'overview'
        | 'quantification'
        | 'bowtie'
        | 'history'
        | 'tasks'
        | 'evidence'
        | 'mappings'
        | 'traceability'
        | 'activity'
        | 'tests';
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const tabs: ReadonlyArray<{ key: Tab; label: string }> = [
        { key: 'overview', label: 'Overview' },
        { key: 'quantification', label: 'Quantification' },
        { key: 'bowtie', label: 'Bow-Tie' },
        { key: 'history', label: 'History' },
        { key: 'tasks', label: 'Tasks' },
        { key: 'evidence', label: 'Evidence' },
        { key: 'mappings', label: 'Mappings' },
        { key: 'traceability', label: 'Traceability' },
        { key: 'activity', label: 'Activity' },
        { key: 'tests', label: 'Tests' },
    ];
    const [editForm, setEditForm] = useState<EditRiskForm>({});

    const fetchRisk = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/risks/${riskId}`));
            if (!res.ok) throw new Error(`Failed to load risk (${res.status})`);
            const data = await res.json();
            setRisk(data);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, riskId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchRisk(); }, [fetchRisk]);

    const startEditing = () => {
        if (!risk) return;
        setEditForm({
            title: risk.title,
            description: risk.description ?? '',
            category: risk.category ?? '',
            likelihood: risk.likelihood,
            impact: risk.impact,
            treatmentOwner: risk.treatmentOwner ?? '',
            ownerUserId: risk.ownerUserId ?? '',
            treatment: risk.treatment ?? '',
            treatmentNotes: risk.treatmentNotes ?? '',
            nextReviewAt: risk.nextReviewAt ? risk.nextReviewAt.split('T')[0] : '',
        });
        setEditing(true);
    };

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setSaving(true);
        setError(null);
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payload: Record<string, any> = {
                title: editForm.title,
                description: editForm.description || null,
                category: editForm.category || null,
                likelihood: editForm.likelihood,
                impact: editForm.impact,
                treatmentOwner: editForm.treatmentOwner || null,
                ownerUserId: editForm.ownerUserId || null,
                treatment: editForm.treatment || null,
                treatmentNotes: editForm.treatmentNotes || null,
            };
            if (editForm.nextReviewAt) {
                payload.nextReviewAt = new Date(editForm.nextReviewAt as string).toISOString();
            } else {
                payload.nextReviewAt = null;
            }

            const res = await fetch(apiUrl(`/risks/${riskId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || `Failed to save (${res.status})`);
            }
            const { risk: updated } = await res.json();
            setRisk(updated);
            setEditing(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        setError(null);
        try {
            const res = await fetch(apiUrl(`/risks/${riskId}/status`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || `Failed to change status (${res.status})`);
            }
            const updated = await res.json();
            setRisk(updated);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            setError(err.message);
        }
    };

    const breadcrumbs = [
        { label: 'Dashboard', href: href('/dashboard') },
        { label: 'Risks', href: href('/risks') },
        { label: risk?.title ?? 'Risk' },
    ];
    if (loading) {
        return (
            <EntityDetailLayout loading title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (error && !risk) {
        return (
            <EntityDetailLayout error={error} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }
    if (!risk) {
        return (
            <EntityDetailLayout empty={{ message: 'Risk not found.' }} title="" breadcrumbs={breadcrumbs}>
                <></>
            </EntityDetailLayout>
        );
    }

    const band = getRiskScoreBand(risk.inherentScore);
    const overdue = isOverdue(risk.nextReviewAt);

    return (
        <EntityDetailLayout
            id="risk-detail-page"
            breadcrumbs={breadcrumbs}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(k) => setActiveTab(k)}

            title={<span id="risk-title-heading">{risk.title}</span>}
            meta={
                <MetaStrip
                    items={[
                        {
                            kind: 'status',
                            label: 'Status',
                            value: risk.status,
                            variant: RISK_STATUS_VARIANT[risk.status] ?? 'neutral',
                        },
                        {
                            kind: 'status',
                            label: 'Inherent Score',
                            value: `${risk.inherentScore} · ${band.label}`,
                            variant: band.variant,
                        },
                        ...(risk.treatmentOwner
                            ? [
                                  {
                                      label: 'Owner',
                                      value: risk.treatmentOwner,
                                  } as const,
                              ]
                            : []),
                        ...(risk.ownerUserId
                            ? [
                                  {
                                      label: 'Assigned to',
                                      value:
                                          riskMembers?.find(
                                              (m) => m.id === risk.ownerUserId,
                                          )?.name ??
                                          riskMembers?.find(
                                              (m) => m.id === risk.ownerUserId,
                                          )?.email ??
                                          'Assigned',
                                  } as const,
                              ]
                            : []),
                        ...(risk.nextReviewAt
                            ? [
                                  {
                                      label: 'Next Review',
                                      value: formatDate(risk.nextReviewAt),
                                      tone: overdue
                                          ? ('critical' as const)
                                          : undefined,
                                  } as const,
                              ]
                            : []),
                    ]}
                />
            }
            actions={
                canWrite && (
                    <Combobox
                        hideSearch
                        id="risk-status-select"
                        selected={STATUS_OPTIONS.find(o => o.value === risk.status) ?? null}
                        setSelected={(opt) => { if (opt) handleStatusChange(opt.value); }}
                        options={STATUS_OPTIONS}
                        placeholder="Status"
                        buttonProps={{ className: 'text-sm' }}
                    />
                )
            }
        >
            {error && (
                <div className={cn(cardVariants({ density: 'compact' }), 'border-border-error text-content-error text-sm')}>{error}</div>
            )}

            {activeTab === 'tasks' && (
                <div className={cardVariants()}>
                    <LinkedTasksPanel
                        apiBase={apiUrl('')}
                        entityType="RISK"
                        entityId={riskId}
                        tenantHref={href}
                        canWrite={canWrite}
                    />
                </div>
            )}
            {activeTab === 'traceability' && (
                <TraceabilityPanel
                    apiBase={apiUrl('')}
                    entityType="risk"
                    entityId={riskId}
                    canWrite={canWrite}
                    tenantHref={href}
                />
            )}
            {activeTab === 'evidence' && (
                <div className="space-y-section">
                    <div className="space-y-default">
                        <Heading level={3}>Attached evidence</Heading>
                        <AttachedEvidencePanel
                            entityId={riskId}
                            entity="risk"
                            endpoint={`/risks/${riskId}/evidence/attached`}
                            apiUrl={apiUrl}
                            tenantHref={href}
                            canWrite={canWrite}
                        />
                    </div>
                    <div className="space-y-default">
                        <Heading level={3}>Inherited from controls</Heading>
                        <InheritedEvidencePanel
                            endpoint={apiUrl(`/risks/${riskId}/evidence`)}
                            tenantHref={href}
                            entityLabel="risk"
                        />
                    </div>
                </div>
            )}
            {activeTab === 'mappings' && (
                <InheritedMappingsPanel
                    endpoint={apiUrl(`/risks/${riskId}/mappings`)}
                    tenantHref={href}
                    entityLabel="risk"
                />
            )}
            {activeTab === 'activity' && (
                <EmptyState
                    size="sm"
                    variant="no-records"
                    title="Risk activity log"
                    description="A dedicated activity feed for this risk is on the roadmap. Tenant-wide audit log is available from Admin → Audit Log."
                />
            )}
            {activeTab === 'tests' && (
                <InheritedTestPlansPanel
                    endpoint={apiUrl(`/risks/${riskId}/test-plans`)}
                    tenantHref={href}
                    entityLabel="risk"
                />
            )}
            {activeTab === 'quantification' && risk && (
                <FairAnalysisPanel
                    riskId={riskId}
                    initial={{
                        threatEventFrequency: risk.threatEventFrequency,
                        contactFrequency: risk.contactFrequency,
                        probabilityOfAction: risk.probabilityOfAction,
                        vulnerabilityProbability: risk.vulnerabilityProbability,
                        threatCapability: risk.threatCapability,
                        controlStrength: risk.controlStrength,
                        primaryLossMagnitude: risk.primaryLossMagnitude,
                        productivityLoss: risk.productivityLoss,
                        responseCost: risk.responseCost,
                        replacementCost: risk.replacementCost,
                        secondaryLossEventFrequency: risk.secondaryLossEventFrequency,
                        secondaryLossMagnitude: risk.secondaryLossMagnitude,
                        fairConfidence: risk.fairConfidence,
                    }}
                />
            )}

            {activeTab === 'bowtie' && <BowTiePanel riskId={riskId} />}

            {activeTab === 'history' && <RiskHistoryPanel riskId={riskId} />}

            {activeTab === 'overview' && (
                <>
            {/* Detail Card */}
            <div className={cn(cardVariants(), 'space-y-default')} id="risk-detail">
                {canWrite && (
                    <div className="flex justify-end -mt-1 -mb-2">
                        {/* B2 — icon-only edit affordance; opens the Edit
                            Risk modal, mirroring the control detail page. */}
                        <Tooltip content="Edit risk">
                            <Button
                                variant="secondary"
                                size="icon"
                                onClick={startEditing}
                                id="edit-risk-btn"
                                aria-label="Edit risk"
                            >
                                <Pen2 className="size-4" />
                            </Button>
                        </Tooltip>
                    </div>
                )}
                {risk.description && (
                    <div>
                        <Eyebrow>Description</Eyebrow>
                        <p className="text-sm text-content-default whitespace-pre-wrap">{risk.description}</p>
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-default">
                    <div>
                        <Eyebrow>Category</Eyebrow>
                        <p className="text-sm">{risk.category || '—'}</p>
                    </div>
                    <div>
                        <Eyebrow>Treatment Owner</Eyebrow>
                        <p className="text-sm">{risk.treatmentOwner || '—'}</p>
                    </div>
                    <div>
                        <Eyebrow>Treatment</Eyebrow>
                        <p className="text-sm">{risk.treatment || 'Untreated'}</p>
                    </div>
                    <div>
                        <Eyebrow>Target Date</Eyebrow>
                        <p className="text-sm">{risk.targetDate ? formatDate(risk.targetDate) : '—'}</p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-default">
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat value={risk.likelihood} label="Likelihood" size="sm" />
                    </div>
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat value={risk.impact} label="Impact" size="sm" />
                    </div>
                    <div className={cardVariants({ density: 'compact' })}>
                        <KPIStat
                            value={risk.inherentScore}
                            label="Inherent Score"
                            size="sm"
                            tone={risk.inherentScore > 12 ? 'critical' : risk.inherentScore > 5 ? 'attention' : 'success'}
                        />
                    </div>
                </div>

                {risk.threat && (
                    <div>
                        <Eyebrow>Threat</Eyebrow>
                        <p className="text-sm text-content-default">{risk.threat}</p>
                    </div>
                )}
                {risk.vulnerability && (
                    <div>
                        <Eyebrow>Vulnerability</Eyebrow>
                        <p className="text-sm text-content-default whitespace-pre-wrap">{risk.vulnerability}</p>
                    </div>
                )}
                {risk.treatmentNotes && (
                    <div>
                        <Eyebrow>Treatment Notes</Eyebrow>
                        <p className="text-sm text-content-default whitespace-pre-wrap">{risk.treatmentNotes}</p>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-default border-t border-border-subtle pt-4">
                    <div>
                        <Eyebrow>Next Review</Eyebrow>
                        <p className={`text-sm ${overdue ? 'text-content-error font-semibold' : ''}`}>
                            {risk.nextReviewAt
                                ? `${overdue ? '! ' : ''}${formatDate(risk.nextReviewAt)}`
                                : '—'
                            }
                        </p>
                    </div>
                    <div>
                        <Eyebrow>Created</Eyebrow>
                        <p className="text-sm text-content-muted">{formatDate(risk.createdAt)}</p>
                    </div>
                </div>
            </div>

            {/* Epic G-7 — Risk Treatment Plan card. Owner-choices left
              * empty here (panel falls back to the current user as
              * the typed-in owner via the Combobox); the eventual
              * tenant-roster fetch is a bounded follow-up that will
              * wire admin/editor members through. */}
            <div className={cardVariants()}>
                <RiskTreatmentPlanCard
                    tenantSlug={tenant.tenantSlug}
                    riskId={riskId}
                    ownerChoices={[]}
                    canWrite={canWrite}
                    canAdmin={tenant.permissions.canAdmin}
                />
            </div>
                </>
            )}

            {/* Edit Risk modal — opened by the Overview-tab Edit button.
                Mirrors the control detail page's EditControlModal. */}
            {canWrite && (
                <EditRiskModal
                    open={editing}
                    setOpen={setEditing}
                    form={editForm}
                    setForm={setEditForm}
                    saving={saving}
                    error={error}
                    tenantSlug={tenant.tenantSlug}
                    categoryOptions={CATEGORY_OPTIONS}
                    treatmentOptions={TREATMENT_OPTIONS}
                    onCancel={() => setEditing(false)}
                    onSubmit={handleSave}
                />
            )}
        </EntityDetailLayout>
    );
}
