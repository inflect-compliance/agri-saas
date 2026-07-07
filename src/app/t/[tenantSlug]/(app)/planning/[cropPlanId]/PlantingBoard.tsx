'use client';

/**
 * PlantingBoard — the succession board on the crop-plan Plantings tab.
 *
 * Two views of the same plan-vs-actual payload
 * (`GET /planning/crop-plans/:id?include=progress`):
 *
 *   1. A <GanttTimeline> — one bar per succession from sow → harvest
 *      end. Reuses the shared timeline primitive (a planting's
 *      lifecycle reads as task-like work, so each row maps to a
 *      `task`-category CalendarEvent).
 *   2. A <DataTable> — succession #, planned + actual sow / transplant
 *      / harvest dates, seed grams, plant count, status. The actual
 *      column shows the journal-recorded date where a LogPlanting
 *      exists, so the farmer sees plan vs reality at a glance.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { createColumns, DataTable } from '@/components/ui/table';
import { GanttTimeline } from '@/components/ui/GanttTimeline';
import { AgStatusBadge } from '@/components/ag/ag-status';
import { SoilSuitabilityBadge } from '@/components/soil/SoilSuitabilityBadge';
import type { SuitabilityFlag } from '@/lib/soil/suitability';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { SkeletonCard, SkeletonLine } from '@/components/ui/skeleton';
import { Heading } from '@/components/ui/typography';
import { Tooltip } from '@/components/ui/tooltip';
import { CircleCheck } from '@/components/ui/icons/nucleo';
import { formatDate } from '@/lib/format-date';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { CalendarEvent } from '@/app-layer/schemas/calendar.schemas';

interface PlantingProgressRow {
    plantingId: string;
    successionNumber: number;
    method: string;
    status: string;
    planned: {
        sowDate: string | null;
        transplantDate: string | null;
        harvestStartDate: string | null;
        harvestEndDate: string | null;
    };
    actual: {
        SOW: string | null;
        TRANSPLANT: string | null;
        HARVEST: string | null;
    };
}

interface PlantingDetail {
    id: string;
    seedQuantityGrams: number | string | null;
    plantCount: number | null;
}

interface ProgressPayload {
    plan: { id: string; name: string };
    progress: PlantingProgressRow[];
}

/**
 * Accumulated GDD for one planting (Agro-intel). Lazily fetches the
 * per-planting GDD endpoint; the board has a small bounded set of rows so
 * SWR's per-key dedup keeps this cheap. Renders "—" until weather exists.
 */
function GddCell({ plantingId }: { plantingId: string }) {
    const t = useTranslations('planning.board');
    const { data, isLoading } = useTenantSWR<{ totalGdd: number; baseTempC: number; days: unknown[] }>(
        `/planning/plantings/${plantingId}/gdd`,
    );
    if (isLoading && !data) {
        return <SkeletonLine className="h-3 w-8" />;
    }
    const total = data?.totalGdd ?? 0;
    if (!data || (data.days?.length ?? 0) === 0) {
        return <span className="text-xs text-content-subtle">—</span>;
    }
    return (
        <Tooltip content={t('gddTooltip', { temp: data.baseTempC })}>
            <span className="text-xs text-content-muted tabular-nums">{total.toLocaleString()}</span>
        </Tooltip>
    );
}

/**
 * Advisory soil-suitability flag for one planting (Soil integration #37).
 * Lazily fetches the per-planting soil endpoint and renders the suitability
 * badge; `unknown` when the parcel has no soil yet or the variety carries no
 * soil preferences. Same lazy-per-row pattern as {@link GddCell}.
 */
function SoilCell({ plantingId }: { plantingId: string }) {
    const { data, isLoading } = useTenantSWR<{
        suitability: { flag: SuitabilityFlag; reason: string };
    }>(`/planning/plantings/${plantingId}/soil`);
    if (isLoading && !data) {
        return <SkeletonLine className="h-3 w-12" />;
    }
    if (!data) {
        return <span className="text-xs text-content-subtle">—</span>;
    }
    return (
        <SoilSuitabilityBadge
            flag={data.suitability.flag}
            reason={data.suitability.reason}
        />
    );
}

/** A planned date beside its actual realisation (or an em-dash). */
function PlannedActual({ planned, actual }: { planned: string | null; actual: string | null }) {
    const t = useTranslations('planning.board');
    if (!planned && !actual) return <span className="text-content-subtle">—</span>;
    return (
        <span className="flex flex-col leading-tight">
            <span className="text-xs text-content-default">{planned ? formatDate(planned) : '—'}</span>
            {actual ? (
                <Tooltip content={t('actualTooltip')}>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-content-success">
                        <CircleCheck className="h-2.5 w-2.5" aria-hidden />
                        {formatDate(actual)}
                    </span>
                </Tooltip>
            ) : null}
        </span>
    );
}

export function PlantingBoard({
    tenantSlug,
    cropPlanId,
}: {
    tenantSlug: string;
    cropPlanId: string;
}) {
    const t = useTranslations('planning.board');
    const tSoil = useTranslations('ag.soil');
    // Plan-vs-actual progress + the planting rows (for seed/plant-count).
    const progressSWR = useTenantSWR<ProgressPayload>(
        `/planning/crop-plans/${cropPlanId}?include=progress`,
    );
    const plantingsSWR = useTenantSWR<PlantingDetail[]>(
        `/planning/plantings?cropPlanId=${cropPlanId}`,
    );

    const progress = useMemo(() => progressSWR.data?.progress ?? [], [progressSWR.data]);
    const plantingById = useMemo(() => {
        const map = new Map<string, PlantingDetail>();
        for (const p of plantingsSWR.data ?? []) map.set(p.id, p);
        return map;
    }, [plantingsSWR.data]);

    // ── Gantt range + events ──
    const { from, to, events } = useMemo(() => {
        const dates: number[] = [];
        for (const row of progress) {
            for (const d of [row.planned.sowDate, row.planned.harvestEndDate]) {
                if (d) dates.push(new Date(d).getTime());
            }
        }
        const now = Date.now();
        const min = dates.length ? Math.min(...dates) : now;
        const max = dates.length ? Math.max(...dates) : now + 30 * 86_400_000;
        // Pad the range a little so end bars aren't flush to the edge.
        const pad = 3 * 86_400_000;
        const events: CalendarEvent[] = progress
            .filter((r) => r.planned.sowDate && r.planned.harvestEndDate)
            .map((r) => ({
                id: `planting:${r.plantingId}`,
                // A planting's lifecycle is task-like work — map onto the
                // shared CalendarEvent's `task` category so the Gantt's
                // tone bundle applies. `href` stays on this plan's page.
                type: 'task-due',
                category: 'task',
                title: `#${r.successionNumber}`,
                date: r.planned.sowDate!,
                end: r.planned.harvestEndDate!,
                status: r.actual.HARVEST ? 'done' : 'scheduled',
                entityType: 'TASK',
                entityId: r.plantingId,
                href: `/t/${tenantSlug}/planning/${cropPlanId}`,
                detail: `Succession ${r.successionNumber}`,
            }));
        return { from: new Date(min - pad), to: new Date(max + pad), events };
    }, [progress, tenantSlug, cropPlanId]);

    const columns = useMemo(
        () =>
            createColumns<PlantingProgressRow>([
                {
                    id: 'succession',
                    header: t('colNum'),
                    accessorFn: (r) => r.successionNumber,
                    cell: ({ row }) => (
                        <span className="text-xs font-medium text-content-emphasis tabular-nums">
                            {row.original.successionNumber}
                        </span>
                    ),
                },
                {
                    id: 'sow',
                    header: t('colSow'),
                    accessorFn: (r) => r.planned.sowDate ?? '',
                    cell: ({ row }) => (
                        <PlannedActual planned={row.original.planned.sowDate} actual={row.original.actual.SOW} />
                    ),
                    meta: { disableTruncate: true },
                },
                {
                    id: 'transplant',
                    header: t('colTransplant'),
                    accessorFn: (r) => r.planned.transplantDate ?? '',
                    cell: ({ row }) => (
                        <PlannedActual
                            planned={row.original.planned.transplantDate}
                            actual={row.original.actual.TRANSPLANT}
                        />
                    ),
                    meta: { disableTruncate: true },
                },
                {
                    id: 'harvest',
                    header: t('colHarvest'),
                    accessorFn: (r) => r.planned.harvestStartDate ?? '',
                    cell: ({ row }) => (
                        <PlannedActual
                            planned={row.original.planned.harvestStartDate}
                            actual={row.original.actual.HARVEST}
                        />
                    ),
                    meta: { disableTruncate: true },
                },
                {
                    id: 'seed',
                    header: t('colSeed'),
                    accessorFn: (r) => plantingById.get(r.plantingId)?.seedQuantityGrams ?? '',
                    cell: ({ row }) => {
                        const g = plantingById.get(row.original.plantingId)?.seedQuantityGrams;
                        return (
                            <span className="text-xs text-content-muted tabular-nums">
                                {g != null ? Number(g).toLocaleString() : '—'}
                            </span>
                        );
                    },
                },
                {
                    id: 'plants',
                    header: t('colPlants'),
                    accessorFn: (r) => plantingById.get(r.plantingId)?.plantCount ?? '',
                    cell: ({ row }) => {
                        const n = plantingById.get(row.original.plantingId)?.plantCount;
                        return (
                            <span className="text-xs text-content-muted tabular-nums">
                                {n != null ? n.toLocaleString() : '—'}
                            </span>
                        );
                    },
                },
                {
                    id: 'gdd',
                    header: t('colGdd'),
                    enableSorting: false,
                    cell: ({ row }) => <GddCell plantingId={row.original.plantingId} />,
                },
                {
                    id: 'soil',
                    header: tSoil('suitabilityTitle'),
                    enableSorting: false,
                    cell: ({ row }) => <SoilCell plantingId={row.original.plantingId} />,
                },
                {
                    accessorKey: 'status',
                    header: t('colStatus'),
                    cell: ({ row }) => (
                        <AgStatusBadge entity="planting" status={row.original.status} />
                    ),
                },
            ]),
        [plantingById, t, tSoil],
    );

    if (progressSWR.isLoading && !progressSWR.data) {
        return <SkeletonCard lines={5} />;
    }
    if (progressSWR.error) {
        return (
            <InlineEmptyState
                title={t('loadErrorTitle')}
                description={t('loadErrorDesc')}
            />
        );
    }
    if (progress.length === 0) {
        return (
            <InlineEmptyState
                title={t('emptyTitle')}
                description={t('emptyDesc')}
            />
        );
    }

    return (
        <div className="space-y-section" data-testid="planting-board">
            {/* Succession timeline */}
            <div className={cn(cardVariants({ density: 'compact' }), 'space-y-default')}>
                <Heading level={3}>{t('successionTimeline')}</Heading>
                <GanttTimeline from={from} to={to} events={events} data-testid="planting-gantt" />
            </div>

            {/* Plan-vs-actual table */}
            <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')} id="planting-table">
                <DataTable
                    data={progress}
                    columns={columns}
                    getRowId={(r) => r.plantingId}
                    selectionEnabled={false}
                    virtualize={false}
                />
            </div>
        </div>
    );
}
