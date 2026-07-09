'use client';

import { useTranslations } from 'next-intl';
import { ShareableStatCard, type ShareStat } from '@/components/ui/shareable-stat-card';

/**
 * Shareable "spray job complete" card (feat/delight-shareables) — shown when
 * every parcel on a field operation is done. A satisfying thing to keep/show.
 */
export function SprayJobCompletionCard({
    title,
    parcelsDone,
    areaCoveredHa,
    productName,
}: {
    title: string;
    parcelsDone: number;
    areaCoveredHa: number;
    productName?: string | null;
}) {
    const t = useTranslations('agStatus');
    const stats: ShareStat[] = [
        { label: t('spray.parcelsDone'), value: String(parcelsDone) },
        { label: t('spray.areaCovered'), value: `${Math.round(areaCoveredHa * 10) / 10} ha` },
    ];
    if (productName) stats.push({ label: t('spray.product'), value: productName });

    return (
        <ShareableStatCard
            eyebrow={t('spray.complete')}
            title={title}
            stats={stats}
            fileName={`spray-job-${title}`}
        />
    );
}

export default SprayJobCompletionCard;
