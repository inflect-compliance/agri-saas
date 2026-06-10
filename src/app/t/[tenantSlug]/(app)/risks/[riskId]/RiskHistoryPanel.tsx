'use client';

/* RQ-9 — Risk history tab: score + ALE trend over snapshots. */
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/typography';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { formatDate } from '@/lib/format-date';

interface Snap { id: string; score: number; ale: number | null; snapshotAt: string }
const SPARK = '▁▂▃▄▅▆▇█';
function sparkline(values: number[]): string {
    if (values.length === 0) return '—';
    const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
    return values.map((v) => SPARK[Math.min(SPARK.length - 1, Math.floor(((v - min) / span) * (SPARK.length - 1)))]).join('');
}
const money = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

export function RiskHistoryPanel({ riskId }: { riskId: string }) {
    const apiUrl = useTenantApiUrl();
    const [history, setHistory] = useState<Snap[] | null>(null);

    useEffect(() => {
        let live = true;
        fetch(apiUrl(`/risks/${riskId}/history`)).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setHistory(d.history); }).catch(() => {});
        return () => { live = false; };
    }, [apiUrl, riskId]);

    if (!history) return <Card className="p-6"><p className="text-sm text-content-muted">Loading history…</p></Card>;
    if (history.length === 0) {
        return <Card className="p-6"><p className="text-sm text-content-muted">No history yet. Daily snapshots accrue once the risk-snapshot job has run.</p></Card>;
    }

    const aleSeries = history.map((s) => s.ale ?? 0);
    const scoreSeries = history.map((s) => s.score);
    const first = history[0]; const last = history[history.length - 1];
    const aleDelta = (last.ale ?? 0) - (first.ale ?? 0);

    return (
        <Card className="space-y-default p-6" data-testid="risk-history">
            <Heading level={2}>History</Heading>
            <p className="text-xs text-content-muted">{history.length} snapshots · {formatDate(new Date(first.snapshotAt))} → {formatDate(new Date(last.snapshotAt))}</p>
            <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                <div className="rounded-md bg-bg-muted/20 px-default py-default">
                    <div className="text-xs text-content-muted">ALE trend</div>
                    <div className="font-mono text-lg leading-none text-content-emphasis" aria-label="ALE trend">{sparkline(aleSeries)}</div>
                    <div className="mt-tight text-sm tabular-nums text-content-muted">{money(first.ale)} → {money(last.ale)} ({aleDelta >= 0 ? '+' : '−'}{money(Math.abs(aleDelta))})</div>
                </div>
                <div className="rounded-md bg-bg-muted/20 px-default py-default">
                    <div className="text-xs text-content-muted">Score trend</div>
                    <div className="font-mono text-lg leading-none text-content-emphasis" aria-label="Score trend">{sparkline(scoreSeries)}</div>
                    <div className="mt-tight text-sm tabular-nums text-content-muted">{first.score} → {last.score}</div>
                </div>
            </div>
        </Card>
    );
}
