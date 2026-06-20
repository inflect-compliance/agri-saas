'use client';

import { ShareableStatCard, type ShareStat } from '@/components/ui/shareable-stat-card';

/**
 * Shareable "field report" card for a location (feat/delight-shareables) —
 * parcels, total area, and the crops grown. Self-hides until the field has
 * parcels.
 */
export function FieldReportCard({
    locationName,
    parcels,
}: {
    locationName: string;
    parcels: Array<{ areaHa?: number | null; cropType?: string | null }>;
}) {
    if (parcels.length === 0) return null;

    const totalArea = parcels.reduce((sum, p) => sum + (p.areaHa ?? 0), 0);
    const crops = Array.from(
        new Set(parcels.map((p) => p.cropType).filter((c): c is string => !!c)),
    );

    const stats: ShareStat[] = [
        { label: 'Parcels', value: String(parcels.length) },
        { label: 'Total area', value: `${Math.round(totalArea * 10) / 10} ha` },
    ];
    if (crops.length > 0) stats.push({ label: 'Crops', value: crops.slice(0, 3).join(', ') });

    return (
        <ShareableStatCard
            eyebrow="Field report"
            title={locationName}
            stats={stats}
            fileName={`field-report-${locationName}`}
        />
    );
}

export default FieldReportCard;
