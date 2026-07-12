'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { StackY3 } from '@/components/ui/icons/nucleo/stack-y-3';
import { ArrowTrendUp } from '@/components/ui/icons/nucleo/arrow-trend-up';
import { MoneyBill } from '@/components/ui/icons/nucleo/money-bill';
import { BoxArchive } from '@/components/ui/icons/nucleo/box-archive';

import { ListPageShell } from '@/components/layout/ListPageShell';
import { DataTable, createColumns, TableEmptyState } from '@/components/ui/table';
import { StatusBreakdown, type StatusBreakdownItem } from '@/components/ui/status-breakdown';
import { EmptyState } from '@/components/ui/empty-state';
import KpiCard from '@/components/ui/KpiCard';
import { Heading } from '@/components/ui/typography';
import type {
    PortfolioGrainSummary,
    PortfolioGrainTenantRow,
} from '@/app-layer/usecases/portfolio-grain';

/**
 * Org portfolio grain dashboard (client island).
 *
 * Pure presentation over the server-computed `PortfolioGrainSummary`:
 *   - four KPI tiles for the org totals,
 *   - a per-farm yield breakdown visual (shared `<StatusBreakdown>`),
 *   - a per-tenant `<DataTable>` (contracted / yield / cost / bin fill).
 *
 * No fetching, no mutation — the cross-tenant aggregation already ran
 * server-side inside the RLS-bound fan-out.
 */

interface Props {
    summary: PortfolioGrainSummary;
}

/** Currency symbol from an ISO-ish code (EUR → €, GBP → £, USD → $),
 *  falling back to the code itself, then '€' (demo default). */
function currencySymbol(currency: string | null): string {
    switch (currency) {
        case 'EUR':
            return '€';
        case 'GBP':
            return '£';
        case 'USD':
            return '$';
        case null:
        case undefined:
            return '€';
        default:
            return `${currency} `;
    }
}

function formatTonnes(n: number): string {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`;
}

function formatCost(n: number, currency: string | null): string {
    const sym = currencySymbol(currency);
    if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(0)}K`;
    return `${sym}${Math.round(n).toLocaleString()}`;
}

export function PortfolioGrainClient({ summary }: Props) {
    const t = useTranslations('grain.portfolio');
    const { totals, perTenant } = summary;
    const sym = currencySymbol(totals.currency);

    const [sortBy, setSortBy] = useState<string>('tenantName');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    const hasGrain = totals.tenantsWithGrain > 0;

    // Per-farm yield breakdown — the ONE visual. Drops zero-yield farms
    // so the chart stays legible; the full table below still lists them.
    const yieldByFarm = useMemo<StatusBreakdownItem[]>(
        () =>
            perTenant
                .filter((r) => r.totalYieldTonnes > 0)
                .sort((a, b) => b.totalYieldTonnes - a.totalYieldTonnes)
                .map((r) => ({
                    id: r.tenantId,
                    label: r.tenantName,
                    value: Math.round(r.totalYieldTonnes),
                    variant: 'success' as const,
                })),
        [perTenant],
    );

    const sorted = useMemo(() => {
        const copy = [...perTenant];
        copy.sort((a, b) => {
            const dir = sortOrder === 'asc' ? 1 : -1;
            switch (sortBy) {
                case 'contractedSaleTonnes':
                    return dir * (a.contractedSaleTonnes - b.contractedSaleTonnes);
                case 'totalYieldTonnes':
                    return dir * (a.totalYieldTonnes - b.totalYieldTonnes);
                case 'totalActivityCost':
                    return dir * (a.totalActivityCost - b.totalActivityCost);
                case 'binStoredTonnes':
                    return dir * (a.binStoredTonnes - b.binStoredTonnes);
                case 'tenantName':
                default:
                    return dir * a.tenantName.localeCompare(b.tenantName);
            }
        });
        return copy;
    }, [perTenant, sortBy, sortOrder]);

    const columns = useMemo(
        () =>
            createColumns<PortfolioGrainTenantRow>([
                {
                    id: 'tenantName',
                    header: t('colFarm'),
                    cell: ({ row }) => (
                        <span className="font-medium text-content-emphasis">
                            {row.original.tenantName}
                        </span>
                    ),
                },
                {
                    id: 'contractedSaleTonnes',
                    header: t('colContracted'),
                    cell: ({ row }) => (
                        <span className="tabular-nums text-content-default">
                            {formatTonnes(row.original.contractedSaleTonnes)}
                            <span className="text-content-subtle">
                                {' / '}
                                {formatTonnes(row.original.contractedPurchaseTonnes)}
                            </span>
                        </span>
                    ),
                },
                {
                    id: 'totalYieldTonnes',
                    header: t('colYield'),
                    cell: ({ row }) => (
                        <span className="tabular-nums text-content-default">
                            {formatTonnes(row.original.totalYieldTonnes)}
                        </span>
                    ),
                },
                {
                    id: 'totalActivityCost',
                    header: t('colActivityCost'),
                    cell: ({ row }) => (
                        <span className="tabular-nums text-content-default">
                            {formatCost(row.original.totalActivityCost, row.original.currency)}
                        </span>
                    ),
                },
                {
                    id: 'binStoredTonnes',
                    header: t('colBinFill'),
                    cell: ({ row }) => {
                        const { binStoredTonnes, binCapacityTonnes, binCount } = row.original;
                        if (binCount === 0) {
                            return <span className="text-content-subtle">—</span>;
                        }
                        const pct =
                            binCapacityTonnes > 0
                                ? Math.round((binStoredTonnes / binCapacityTonnes) * 100)
                                : null;
                        return (
                            <span className="tabular-nums text-content-default">
                                {formatTonnes(binStoredTonnes)}
                                {binCapacityTonnes > 0 && (
                                    <span className="text-content-subtle">
                                        {' / '}
                                        {formatTonnes(binCapacityTonnes)}
                                        {pct != null ? ` (${pct}%)` : ''}
                                    </span>
                                )}
                            </span>
                        );
                    },
                },
            ]),
        [t],
    );

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <div>
                    <Heading level={1}>{t('title')}</Heading>
                    <p className="text-sm text-content-muted mt-1">
                        {t('subtitle', {
                            count: totals.tenantsTotal,
                            withGrain:
                                totals.tenantsWithGrain < totals.tenantsTotal
                                    ? t('withGrainData', { count: totals.tenantsWithGrain })
                                    : '',
                        })}
                    </p>
                </div>
            </ListPageShell.Header>

            {!hasGrain ? (
                <ListPageShell.Body>
                    <EmptyState
                        icon={StackY3}
                        title={t('emptyTitle')}
                        description={t('emptyDescription')}
                        variant="no-records"
                        data-testid="org-grain-empty"
                    />
                </ListPageShell.Body>
            ) : (
                <ListPageShell.Body>
                    <div className="space-y-section">
                        {/* KPI tiles — org totals. */}
                        <div
                            className="grid grid-cols-1 gap-default sm:grid-cols-2 xl:grid-cols-4"
                            data-testid="org-grain-kpis"
                        >
                            <KpiCard
                                label={t('kpiContractedSale')}
                                value={totals.contractedSaleTonnes}
                                format="compact"
                                icon={StackY3}
                                subtitle={t('kpiPurchaseSubtitle', { amount: formatTonnes(totals.contractedPurchaseTonnes) })}
                                trendPolarity="neutral"
                            />
                            <KpiCard
                                label={t('kpiHarvestedYield')}
                                value={totals.totalYieldTonnes}
                                format="compact"
                                icon={ArrowTrendUp}
                                gradient="from-emerald-500 to-teal-500"
                                trendVariant="success"
                                subtitle={t('kpiAcrossFarms')}
                                trendPolarity="neutral"
                            />
                            <KpiCard
                                label={t('kpiActivityCost')}
                                value={totals.totalActivityCost}
                                format="compact"
                                icon={MoneyBill}
                                gradient="from-amber-500 to-orange-500"
                                subtitle={
                                    totals.currency
                                        ? t('kpiTotalCurrency', { currency: totals.currency })
                                        : t('kpiTotal')
                                }
                                trendPolarity="neutral"
                            />
                            <KpiCard
                                label={t('kpiBinUtilisation')}
                                value={totals.binUtilisationPct}
                                format="percent"
                                icon={BoxArchive}
                                gradient="from-sky-500 to-indigo-500"
                                subtitle={t('kpiBinSubtitle', { stored: formatTonnes(totals.binStoredTonnes), capacity: formatTonnes(totals.binCapacityTonnes) })}
                                trendPolarity="neutral"
                            />
                        </div>

                        {/* Yield-by-farm breakdown — the single visual. */}
                        {yieldByFarm.length > 0 && (
                            <section
                                className="rounded-lg border border-border-default bg-bg-default p-4"
                                data-testid="org-grain-yield-by-farm"
                            >
                                <Heading level={3}>{t('yieldByFarm')}</Heading>
                                <p className="text-xs text-content-muted mt-1 mb-3">
                                    {t('yieldByFarmNote', { sym })}
                                </p>
                                <StatusBreakdown
                                    items={yieldByFarm}
                                    showPercent
                                    ariaLabel={t('yieldByFarmAria')}
                                />
                            </section>
                        )}

                        {/* Per-tenant breakdown table.
                            mobileFallback="scroll" — this is a wide, dense
                            numeric portfolio grid (contracted / yield / cost /
                            bin-stored tonnes per farm). The figures only make
                            sense side-by-side for cross-farm comparison, so on
                            a phone we keep the horizontally-scrollable table
                            rather than collapse each farm row into a card. */}
                        <DataTable<PortfolioGrainTenantRow>
                            data={sorted}
                            mobileFallback="scroll"
                            columns={columns}
                            getRowId={(r) => r.tenantId}
                            sortableColumns={[
                                'tenantName',
                                'contractedSaleTonnes',
                                'totalYieldTonnes',
                                'totalActivityCost',
                                'binStoredTonnes',
                            ]}
                            sortBy={sortBy}
                            sortOrder={sortOrder}
                            onSortChange={(p) => {
                                if (p.sortBy) setSortBy(p.sortBy);
                                if (p.sortOrder) setSortOrder(p.sortOrder);
                            }}
                            resourceName={(plural) => (plural ? t('farms') : t('farm'))}
                            emptyState={
                                <TableEmptyState
                                    title={t('tableEmptyTitle')}
                                    description={t('tableEmptyDescription')}
                                    icon={<StackY3 className="size-10" />}
                                />
                            }
                            data-testid="org-grain-table"
                        />
                    </div>
                </ListPageShell.Body>
            )}
        </ListPageShell>
    );
}
