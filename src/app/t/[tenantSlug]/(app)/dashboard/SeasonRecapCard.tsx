'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ShareableStatCard, type ShareStat } from '@/components/ui/shareable-stat-card';
import { useToast } from '@/components/ui/hooks';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl, useMoneyFormatter } from '@/lib/tenant-context-provider';
import type { SeasonRecap } from '@/app-layer/usecases/season-recap';

function round1(n: number): string {
    return (Math.round(n * 10) / 10).toString();
}

/**
 * SeasonRecapCard — the shareable "Year on the farm" summary + a one-tap PDF
 * (feat/delight-shareables). Self-hides until there's something to recap, so a
 * fresh tenant never sees an empty card.
 */
export function SeasonRecapCard() {
    const { data } = useTenantSWR<SeasonRecap>('/reports/season-recap');
    const buildUrl = useTenantApiUrl();
    const money = useMoneyFormatter();
    const toast = useToast();
    const [pdfBusy, setPdfBusy] = useState(false);

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

    async function downloadPdf() {
        setPdfBusy(true);
        try {
            const res = await fetch(buildUrl('/reports/year-on-farm'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `year-on-farm-${data?.year ?? 'all-time'}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch {
            toast.error("Couldn't generate the PDF", { description: 'Please try again.' });
        } finally {
            setPdfBusy(false);
        }
    }

    return (
        <div className="space-y-default">
            <ShareableStatCard
                eyebrow={data.seasonName ? `Season recap · ${data.seasonName}` : 'Season recap'}
                title="Year on the farm"
                subtitle={data.year ? `${data.year}` : 'Your operation so far'}
                stats={stats}
                footer={footer}
                fileName={`season-recap-${data.year ?? 'all-time'}`}
            />
            <Button variant="ghost" size="sm" loading={pdfBusy} onClick={downloadPdf}>
                Download &ldquo;Year on the farm&rdquo; PDF
            </Button>
        </div>
    );
}

export default SeasonRecapCard;
