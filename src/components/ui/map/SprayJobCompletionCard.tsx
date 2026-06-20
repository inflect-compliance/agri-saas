'use client';

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
    const stats: ShareStat[] = [
        { label: 'Parcels done', value: String(parcelsDone) },
        { label: 'Area covered', value: `${Math.round(areaCoveredHa * 10) / 10} ha` },
    ];
    if (productName) stats.push({ label: 'Product', value: productName });

    return (
        <ShareableStatCard
            eyebrow="Spray job complete"
            title={title}
            stats={stats}
            fileName={`spray-job-${title}`}
        />
    );
}

export default SprayJobCompletionCard;
