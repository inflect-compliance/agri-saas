/**
 * RQ3-8 — Best-value controls leaderboard (controls list rail).
 *
 * Reads `/controls/best-value?limit=10` and renders a small
 * ranked list, each row deep-linking into the control's detail
 * page. When no control qualifies (no cost + effectiveness + a
 * quantified linked risk anywhere), the panel renders an honest
 * empty-state — never a fabricated leaderboard with synthetic
 * zeros.
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { formatCompactCurrency } from '@/lib/risk-coherence';
import { SkeletonCard } from '@/components/ui/skeleton';

interface BestValueRow {
    controlId: string;
    code: string | null;
    name: string;
    annualCost: number;
    effectiveness: number;
    aleProtected: number;
    roiMultiple: number;
    quantifiedRiskCount: number;
    linkedRiskCount: number;
}

export function BestValueControls({ limit = 5 }: { limit?: number }) {
    const t = useTranslations('controls');
    const { currencySymbol } = useTenantContext();
    const tenantHref = useTenantHref();
    const sym = currencySymbol ?? '€';
    const { data, isLoading } = useTenantSWR<BestValueRow[]>(
        `/controls/best-value?limit=${limit}`,
    );

    if (isLoading) {
        return (
            <div data-testid="best-value-controls-loading">
                <SkeletonCard lines={3} />
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div
                className="px-2 py-1 text-xs text-content-subtle"
                data-testid="best-value-controls-empty"
            >
                {t('bestValue.empty')}
            </div>
        );
    }

    return (
        <ol
            className="space-y-tight text-sm"
            data-testid="best-value-controls"
        >
            {data.map((row, idx) => (
                <li
                    key={row.controlId}
                    className="flex items-baseline gap-tight"
                    data-testid={`best-value-row-${row.controlId}`}
                >
                    <span className="w-6 text-content-subtle text-xs tabular-nums">
                        {idx + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                        <Link
                            href={tenantHref(`/controls/${row.controlId}`)}
                            className="block truncate text-content-default hover:text-content-emphasis"
                        >
                            {row.code ? `${row.code} — ${row.name}` : row.name}
                        </Link>
                        <p className="text-xs text-content-subtle">
                            {t('bestValue.savedOn', {
                                protectedAmount: formatCompactCurrency(row.aleProtected, sym),
                                cost: formatCompactCurrency(row.annualCost, sym),
                            })}
                        </p>
                    </div>
                    <span
                        className="text-sm font-medium text-content-emphasis tabular-nums"
                        data-testid={`best-value-roi-${row.controlId}`}
                    >
                        {row.roiMultiple.toFixed(1)}×
                    </span>
                </li>
            ))}
        </ol>
    );
}
