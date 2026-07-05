/**
 * RQ3-8 — Control ROI summary card (control detail overview).
 *
 * Reads `/controls/:id/roi` and renders one of:
 *
 *   - ok verdict → "this control buys €X reduction for €Y/yr
 *     (ROI Z×)", with the per-risk count callout;
 *   - gap verdict → a typed, plain-English nudge ("Set an annual
 *     cost…" / "Quantify the linked risks…") — never a fabricated
 *     zero.
 *
 * The card mounts independently of the page-data SWR cache so the
 * verdict reflects link-add / unlink updates without forcing a
 * full page re-render.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantContext } from '@/lib/tenant-context-provider';
import { formatCompactCurrency } from '@/lib/risk-coherence';
import { describeRoiGap, type ControlRoiVerdict } from '@/lib/control-roi';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { SkeletonCard } from '@/components/ui/skeleton';

interface RoiPayload {
    controlId: string;
    code: string | null;
    name: string;
    annualCost: number | null;
    effectiveness: number | null;
    verdict: ControlRoiVerdict;
}

export function ControlRoiCard({ controlId }: { controlId: string }) {
    const t = useTranslations('controls');
    const { currencySymbol } = useTenantContext();
    const sym = currencySymbol ?? '€';
    const { data, error, isLoading } = useTenantSWR<RoiPayload>(`/controls/${controlId}/roi`);

    if (isLoading || !data) {
        if (error) return null;
        return (
            <div className={cn(cardVariants(), 'space-y-default')} data-testid="control-roi-card-loading">
                <SkeletonCard lines={2} />
            </div>
        );
    }

    const { verdict, annualCost, effectiveness } = data;

    return (
        <div
            className={cn(cardVariants(), 'space-y-default')}
            data-testid="control-roi-card"
        >
            <div>
                <span className="text-xs text-content-subtle uppercase">{t('roi.title')}</span>
            </div>
            {verdict.ok ? (
                <div className="space-y-default">
                    <p className="text-sm text-content-default" data-testid="control-roi-headline">
                        {t('roi.reduceLead')}{' '}
                        <strong>{formatCompactCurrency(verdict.value.aleProtected, sym)}/yr</strong>{' '}
                        {t('roi.reduceOn')}{' '}
                        <strong>{formatCompactCurrency(annualCost, sym)}/yr</strong>{' '}
                        {t('roi.reduceSpend')}{' '}
                        <strong data-testid="control-roi-multiple">
                            {verdict.value.roiMultiple.toFixed(1)}×
                        </strong>{' '}
                        {t('roi.reduceTail')}
                    </p>
                    <p className="text-xs text-content-subtle">
                        {t('roi.across', {
                            quantified: verdict.value.quantifiedRiskCount,
                            linked: verdict.value.linkedRiskCount,
                            effectiveness: effectiveness ?? 0,
                        })}
                    </p>
                </div>
            ) : (
                <div className="space-y-default">
                    <p className="text-sm text-content-warning" data-testid="control-roi-gap">
                        {describeRoiGap(verdict)}
                    </p>
                    <p className="text-xs text-content-subtle">
                        {t('roi.gapNote')}
                    </p>
                </div>
            )}
        </div>
    );
}
