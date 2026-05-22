'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppIcon } from '@/components/icons/AppIcon';
import { useTenantContext, useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import dynamic from 'next/dynamic';
import LinkedTasksPanel from '@/components/LinkedTasksPanel';
import { AsidePanel } from '@/components/ui/aside-panel';
import { Eyebrow } from '@/components/ui/typography';
import { CardHeader } from '@/components/ui/card-header';
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
import { Button, buttonVariants } from '@/components/ui/button';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { StatusBadge } from '@/components/ui/status-badge';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import {
    parseYMD,
    startOfUtcDay,
    toYMD,
} from '@/components/ui/date-picker/date-utils';
import { NumberStepper } from '@/components/ui/number-stepper';
import { cn } from '@dub/utils';
import { cardVariants } from '@/components/ui/card';

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
};

const STATUS_VALUES = ['OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED'] as const;
const STATUS_OPTIONS: ComboboxOption[] = STATUS_VALUES.map(s => ({ value: s, label: s }));
const CATEGORIES = [
    'Technical', 'Operational', 'Compliance', 'Strategic',
    'Financial', 'Reputational', 'Physical', 'Human Resources',
];
const CATEGORY_OPTIONS: ComboboxOption[] = CATEGORIES.map(c => ({ value: c, label: c }));
const TREATMENT_OPTIONS: ComboboxOption[] = [
    { value: 'TREAT', label: 'Treat' },
    { value: 'TRANSFER', label: 'Transfer' },
    { value: 'TOLERATE', label: 'Tolerate' },
    { value: 'AVOID', label: 'Avoid' },
];

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

    const [risk, setRisk] = useState<Risk | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editForm, setEditForm] = useState<Partial<Risk>>({});

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
            treatment: risk.treatment ?? '',
            treatmentNotes: risk.treatmentNotes ?? '',
            nextReviewAt: risk.nextReviewAt ? risk.nextReviewAt.split('T')[0] : '',
        });
        setEditing(true);
    };

    const handleSave = async () => {
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

    const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setEditForm(f => ({ ...f, [field]: e.target.value }));

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
                canWrite && !editing && (
                    <>
                        <Button variant="secondary" onClick={startEditing} id="edit-risk-btn">Edit</Button>
                        <Combobox
                            hideSearch
                            id="risk-status-select"
                            selected={STATUS_OPTIONS.find(o => o.value === risk.status) ?? null}
                            setSelected={(opt) => { if (opt) handleStatusChange(opt.value); }}
                            options={STATUS_OPTIONS}
                            placeholder="Status"
                            matchTriggerWidth
                            buttonProps={{ className: 'w-36 text-sm' }}
                        />
                    </>
                )
            }
            // Right-rail roadmap Phase 1 — Linked Tasks rides the
            // `<AsidePanel>` primitive: a docked, collapsible rail at
            // xl+ (state persisted per surface), and a `<Sheet>`
            // below xl. The page owns the content; the panel owns the
            // chrome.
            rail={
                <AsidePanel
                    title="Linked Tasks"
                    surfaceKey="risk-detail"
                    icon={<AppIcon name="tasks" size={16} />}
                >
                    <LinkedTasksPanel
                        apiBase={apiUrl('')}
                        entityType="RISK"
                        entityId={riskId}
                        tenantHref={href}
                    />
                </AsidePanel>
            }
        >
            {error && (
                <div className={cn(cardVariants({ density: 'compact' }), 'border-border-error text-content-error text-sm')}>{error}</div>
            )}

            {/* Detail / Edit Card */}
            <div className={cn(cardVariants(), 'space-y-default')} id="risk-detail">
                {editing ? (
                    /* ─── Edit Mode ─── */
                    <>
                        <div>
                            <label className="input-label">Title *</label>
                            <input className="input" value={editForm.title ?? ''} onChange={set('title')} />
                        </div>
                        <div>
                            <label className="input-label">Description</label>
                            <textarea className="input min-h-[100px]" value={editForm.description ?? ''} onChange={set('description')} />
                        </div>
                        <div className="grid grid-cols-2 gap-default">
                            <div>
                                <label className="input-label">Category</label>
                                <Combobox
                                    hideSearch
                                    selected={CATEGORY_OPTIONS.find(o => o.value === (editForm.category ?? '')) ?? null}
                                    setSelected={(opt) => setEditForm(f => ({ ...f, category: opt?.value ?? '' }))}
                                    options={CATEGORY_OPTIONS}
                                    placeholder="— Select —"
                                    matchTriggerWidth
                                />
                            </div>
                            <div>
                                <label className="input-label">Treatment Owner</label>
                                <input className="input" value={editForm.treatmentOwner ?? ''} onChange={set('treatmentOwner')} />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-default">
                            {/* Epic 60 — NumberStepper replaces raw number inputs
                                on the ISO 27005 1..5 likelihood/impact scale.
                                Matches the Assets CIA fields for consistency. */}
                            <div>
                                <label className="input-label" htmlFor="risk-likelihood">Likelihood</label>
                                <NumberStepper
                                    id="risk-likelihood"
                                    size="sm"
                                    ariaLabel="Likelihood (1–5)"
                                    min={1}
                                    max={5}
                                    value={editForm.likelihood ?? 3}
                                    onChange={(v) => setEditForm(f => ({ ...f, likelihood: v }))}
                                />
                            </div>
                            <div>
                                <label className="input-label" htmlFor="risk-impact">Impact</label>
                                <NumberStepper
                                    id="risk-impact"
                                    size="sm"
                                    ariaLabel="Impact (1–5)"
                                    min={1}
                                    max={5}
                                    value={editForm.impact ?? 3}
                                    onChange={(v) => setEditForm(f => ({ ...f, impact: v }))}
                                />
                            </div>
                            <div>
                                <label className="input-label">Score</label>
                                <div className="input bg-bg-subtle flex items-center text-lg font-bold">
                                    {(editForm.likelihood ?? 3) * (editForm.impact ?? 3)}
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-default">
                            <div>
                                <label className="input-label">Treatment</label>
                                <Combobox
                                    hideSearch
                                    selected={TREATMENT_OPTIONS.find(o => o.value === (editForm.treatment ?? '')) ?? null}
                                    setSelected={(opt) => setEditForm(f => ({ ...f, treatment: opt?.value ?? '' }))}
                                    options={TREATMENT_OPTIONS}
                                    placeholder="—"
                                    matchTriggerWidth
                                />
                            </div>
                            <div>
                                <label className="input-label" htmlFor="risk-next-review-inline">Next Review</label>
                                {/* Epic 58 — shared DatePicker; `editForm.nextReviewAt`
                                    stays a YMD string for the PATCH payload. */}
                                <DatePicker
                                    id="risk-next-review-inline"
                                    className="w-full"
                                    placeholder="Pick date"
                                    clearable
                                    align="start"
                                    value={parseYMD(editForm.nextReviewAt ?? '')}
                                    onChange={(next) =>
                                        setEditForm((f) => ({
                                            ...f,
                                            nextReviewAt: toYMD(next) ?? '',
                                        }))
                                    }
                                    disabledDays={{
                                        before: startOfUtcDay(new Date()),
                                    }}
                                    aria-label="Next review date"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="input-label">Treatment Notes</label>
                            <textarea className="input min-h-[80px]" value={editForm.treatmentNotes ?? ''} onChange={set('treatmentNotes')} />
                        </div>
                        <div className="flex gap-compact pt-2">
                            <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} id="save-risk-btn">
                                Save
                            </Button>
                            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                        </div>
                    </>
                ) : (
                    /* ─── Read Mode ─── */
                    <>
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
                    </>
                )}
            </div>

            {/* Traceability */}
            <div className={cardVariants()}>
                {/* Roadmap-3 PR-5 — `<CardHeader>` replaces the
                    inline level=2 heading. Card heading level
                    drops to 3 (the canonical for cards inside
                    pages) and the rhythm matches every other
                    card-header instance. */}
                <CardHeader
                    title={
                        <span className="inline-flex items-center gap-tight">
                            <AppIcon name="link" size={18} /> Traceability
                        </span>
                    }
                    className="mb-default"
                />
                <TraceabilityPanel
                    apiBase={apiUrl('')}
                    entityType="risk"
                    entityId={riskId}
                    canWrite={canWrite}
                    tenantHref={href}
                />
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
        </EntityDetailLayout>
    );
}
