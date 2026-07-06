'use client';

/**
 * Crop-plan detail page.
 *
 *   Overview   — the plan's config (season, crop, method, succession
 *                schedule, allocation).
 *   Plantings  — the succession BOARD (<PlantingBoard>): a Gantt
 *                timeline + a plan-vs-actual table, with a "Generate"
 *                action that re-runs the succession engine.
 *   Journal    — the field-journal entries that recorded actuals
 *                against this plan's plantings.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { apiPost } from '@/lib/api-client';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { SkeletonDetailPage } from '@/components/ui/skeleton';
import { MetaStrip } from '@/components/ui/meta-strip';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format-date';
import { PlantingBoard } from './PlantingBoard';

type Tab = 'overview' | 'plantings' | 'journal';

interface CropPlanDetail {
    id: string;
    name: string;
    status: string;
    method: string;
    firstSowDate: string;
    successions: number;
    intervalDays: number;
    plantsPerSuccession: number | null;
    bedLengthM: number | string | null;
    rowsPerBed: number | null;
    targetAreaM2: number | string | null;
    notes: string | null;
    season?: { id: string; name: string; status: string } | null;
    cropType?: { id: string; name: string } | null;
    variety?: { id: string; name: string; defaultMethod: string | null } | null;
    _count?: { plantings?: number };
}

interface JournalRow {
    id: string;
    type: string;
    title: string;
    occurredAt: string;
}

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
    DRAFT: 'neutral',
    ACTIVE: 'info',
    COMPLETED: 'success',
    CANCELLED: 'warning',
};
export default function CropPlanDetailPage() {
    const t = useTranslations('planning.detail');
    const tp = useTranslations('planning');
    const params = useParams();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, tenantSlug } = useTenantContext();

    const METHOD_LABELS: Record<string, string> = {
        DIRECT_SOW: t('methodDirectSow'),
        TRANSPLANT: t('methodTransplant'),
    };
    const cropPlanId = params?.cropPlanId as string;

    const [tab, setTab] = useState<Tab>('overview');
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);

    const planKey = cropPlanId ? `/planning/crop-plans/${cropPlanId}` : null;
    const planSWR = useTenantSWR<CropPlanDetail>(planKey);
    const plan = planSWR.data ?? null;

    // Journal entries that link to this plan's plantings are surfaced via
    // the plan-vs-actual payload's actuals; the Journal tab lists the
    // tenant journal so the farmer can jump to recording an actual.
    const journalSWR = useTenantSWR<JournalRow[]>(
        cropPlanId && tab === 'journal' ? '/journal' : null,
    );

    const runGenerate = async () => {
        setGenerating(true);
        setGenError(null);
        try {
            await apiPost(apiUrl(`/planning/crop-plans/${cropPlanId}/generate`), {});
            await planSWR.mutate();
        } catch (err) {
            setGenError(err instanceof Error ? err.message : t('genFailed'));
        } finally {
            setGenerating(false);
        }
    };

    if (planSWR.isLoading && !planSWR.data) {
        return (
            <EntityDetailLayout loading title="">
                <SkeletonDetailPage />
            </EntityDetailLayout>
        );
    }
    if (planSWR.error) {
        return (
            <EntityDetailLayout error={planSWR.error.message || t('notFound')} title="">
                {null}
            </EntityDetailLayout>
        );
    }
    if (!plan) {
        return (
            <EntityDetailLayout empty={{ message: t('notFoundMessage') }} title="">
                {null}
            </EntityDetailLayout>
        );
    }

    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'overview', label: t('tabOverview') },
        { key: 'plantings', label: t('tabPlantings'), count: plan._count?.plantings ?? 0 },
        { key: 'journal', label: t('tabJournal') },
    ];

    const headerMeta = (
        <MetaStrip
            items={[
                {
                    kind: 'status' as const,
                    id: 'crop-plan-status',
                    label: t('statusLabel'),
                    value: plan.status,
                    variant: STATUS_VARIANT[plan.status] ?? 'neutral',
                },
                { label: t('season'), value: plan.season?.name ?? '—' },
                { label: t('crop'), value: plan.variety?.name ?? plan.cropType?.name ?? '—' },
            ]}
        />
    );

    const headerActions = permissions.canWrite ? (
        <Button
            variant="primary"
            onClick={runGenerate}
            loading={generating}
            id="crop-plan-generate-btn"
        >
            {t('generate')}
        </Button>
    ) : null;

    return (
        <EntityDetailLayout
            id="crop-plan-detail-page"
            breadcrumbs={[
                { label: tp('bcDashboard'), href: tenantHref('/dashboard') },
                { label: tp('bcPlanting'), href: tenantHref('/planning') },
                { label: plan.name },
            ]}
            title={<span id="crop-plan-title">{plan.name}</span>}
            meta={headerMeta}
            actions={headerActions}
            tabs={tabs}
            activeTab={tab}
            onTabChange={(next) => setTab(next as Tab)}
        >
            {genError && (
                <div
                    className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                    role="alert"
                    id="crop-plan-gen-error"
                >
                    {genError}
                </div>
            )}

            {tab === 'overview' && (
                <div className={cn(cardVariants(), 'space-y-default')}>
                    <div className="grid grid-cols-2 gap-section">
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('method')}</span>
                            <p className="text-sm text-content-default mt-1">
                                {METHOD_LABELS[plan.method] ?? plan.method}
                            </p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('firstSowDate')}</span>
                            <p className="text-sm text-content-default mt-1">{formatDate(plan.firstSowDate)}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('successions')}</span>
                            <p className="text-sm text-content-default mt-1">{plan.successions}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('intervalDays')}</span>
                            <p className="text-sm text-content-default mt-1">{plan.intervalDays}</p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('plantsPerSuccession')}</span>
                            <p className="text-sm text-content-default mt-1">
                                {plan.plantsPerSuccession ?? '—'}
                            </p>
                        </div>
                        <div>
                            <span className="text-xs text-content-subtle uppercase">{t('variety')}</span>
                            <p className="text-sm text-content-default mt-1">{plan.variety?.name ?? '—'}</p>
                        </div>
                        {plan.notes && (
                            <div className="col-span-2">
                                <span className="text-xs text-content-subtle uppercase">{t('notes')}</span>
                                <p className="text-sm text-content-default mt-1">{plan.notes}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === 'plantings' && <PlantingBoard tenantSlug={tenantSlug} cropPlanId={cropPlanId} />}

            {tab === 'journal' && (
                <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                    {journalSWR.isLoading && !journalSWR.data ? (
                        <div className="p-8 text-center text-content-subtle animate-pulse">{t('loadingJournal')}</div>
                    ) : (journalSWR.data?.length ?? 0) === 0 ? (
                        <div className="p-8 text-center text-sm text-content-subtle">
                            {t('journalEmpty')}
                        </div>
                    ) : (
                        <div className="divide-y divide-border-default/50" id="crop-plan-journal-feed">
                            {(journalSWR.data ?? []).slice(0, 50).map((e) => (
                                <a
                                    key={e.id}
                                    href={tenantHref(`/journal/${e.id}`)}
                                    className="flex items-center justify-between px-5 py-3 hover:bg-bg-muted"
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-content-default">{e.title}</span>
                                        <span className="text-xs text-content-subtle">{formatDate(e.occurredAt)}</span>
                                    </span>
                                    <StatusBadge variant="info" size="sm">
                                        {e.type.replace(/_/g, ' ')}
                                    </StatusBadge>
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </EntityDetailLayout>
    );
}
