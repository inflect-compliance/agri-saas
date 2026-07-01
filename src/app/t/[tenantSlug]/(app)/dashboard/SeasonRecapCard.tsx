'use client';

import { ShareableStatCard, type ShareStat } from '@/components/ui/shareable-stat-card';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useMoneyFormatter } from '@/lib/tenant-context-provider';
import type { SeasonRecap } from '@/app-layer/usecases/season-recap';

function round1(n: number): string {
    return (Math.round(n * 10) / 10).toString();
}

/**
 * SeasonRecapCard — the "Year on the farm" summary. Self-hides until there's
 * something to recap, so a fresh tenant never sees an empty card. The
 * Save/share action and the PDF-download button were removed; this is now a
 * display-only recap.
 */
export function SeasonRecapCard() {
    const { data } = useTenantSWR<SeasonRecap>('/reports/season-recap');
    const money = useMoneyFormatter();

    if (!data) return null;
    if (data.totalYieldTonnes <= 0 && data.totalAreaHa <= 0 && data.activityCount <= 0) return null;

    const stats: ShareStat[] = [
        { label: 'Total area', value: `${round1(data.totalAreaHa)} ha` },
        { label: 'Total yield', value: `${round1(data.totalYieldTonnes)} t` },
    ];
    if (data.avgYieldTPerHa != null) stats.push({ label: 'Avg yield', value: `${round1(data.avgYieldTPerHa)} t/ha` });
    if (data.costPerHa != null) stats.push({ label: 'Cost / ha', value: money(data.costPerHa) });

    const footer =
        data.topFields.length > 0 ? (
            <div className="space-y-1">
                <p className="text-xs font-medium text-content-secondary">Top fields</p>
                <ul className="space-y-tight text-sm">
                    {data.topFields.map((f) => (
                        <li key={f.locationId} className="flex items-baseline justify-between gap-default">
                            <span className="truncate text-content-default">{f.name}</span>
                            <span className="shrink-0 font-medium text-content-emphasis">
                                {round1(f.yieldTonnes)} t
                                {f.tPerHa != null ? ` · ${round1(f.tPerHa)} t/ha` : ''}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        ) : null;

    return (
        <ShareableStatCard
            eyebrow={data.seasonName ? `Season recap · ${data.seasonName}` : 'Season recap'}
            title="Year on the farm"
            subtitle={data.year ? `${data.year}` : 'Your operation so far'}
            stats={stats}
            footer={footer}
            fileName={`season-recap-${data.year ?? 'all-time'}`}
            hideShare
        />
    );
}

export default SeasonRecapCard;
