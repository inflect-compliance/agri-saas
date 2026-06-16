'use client';

/**
 * OfflineFieldPanel — the phones-with-gloves operator view of a spray
 * job. Big touch targets; marking a line works OFFLINE: the mutation is
 * optimistically applied and queued in the outbox, then flushed on
 * reconnect (see src/lib/offline). A status bar shows online/offline +
 * the pending-sync count with a manual "Sync now".
 *
 * Distinct from the in-app `FieldOperationPanel` (which marks online-only
 * via apiPatch) — this is the installable-PWA field client.
 */
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Geometry } from 'geojson';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useOfflineSync } from '@/lib/offline/use-offline-sync';
import { saveFieldSnapshot, readFieldSnapshot } from '@/lib/offline/field-snapshot';
import type { MapParcel } from '@/components/ui/map/MapCanvas';

const MapCanvas = dynamic(() => import('@/components/ui/map/MapCanvas').then((m) => m.MapCanvas), { ssr: false });

type LineStatus = 'PENDING' | 'DONE' | 'SKIPPED';
interface Line {
    id: string;
    status: LineStatus;
    doseValue: string | number;
    parcel?: { id: string; name: string; areaHa?: number | null } | null;
    product?: { id: string; name: string } | null;
    doseUnit?: { id: string; symbol: string } | null;
}
interface FieldOpView {
    task: { id: string; key?: string | null; title: string; status: string };
    lines: Line[];
    parcels: Array<{ id: string; name: string; areaHa?: number | null; geometry: unknown }>;
    location: { id: string; name: string; boundsJson: unknown } | null;
    progress: { total: number; done: number };
}

export function OfflineFieldPanel({ taskId }: { taskId: string }) {
    const buildUrl = useTenantApiUrl();
    const { data, mutate, isLoading } = useTenantSWR<FieldOpView>(`/field-operations/${taskId}`);
    const { online, pending, submit, flush } = useOfflineSync();
    const [error, setError] = useState<string | null>(null);

    // Single render source. Seeded from the offline snapshot so the page
    // opens with no signal (cold reload), synced from the server whenever
    // SWR delivers fresh data, and optimistically updated on every mark.
    const [view, setView] = useState<FieldOpView | null>(() =>
        readFieldSnapshot<FieldOpView>(taskId),
    );
    useEffect(() => {
        // Mirror fresh server data (SWR) into the offline-capable view +
        // snapshot when it arrives. Not a render-time derivation: the view is
        // ALSO seeded from the offline snapshot (cold open) and mutated
        // optimistically on marks, so server data is one of three writers.
        if (data) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional server→view sync (see above)
            setView(data);
            saveFieldSnapshot(taskId, data);
        }
    }, [data, taskId]);

    const doneIds = useMemo(
        () => (view?.lines ?? [])
            .filter((l) => l.status !== 'PENDING')
            .map((l) => l.parcel?.id)
            .filter((id): id is string => Boolean(id)),
        [view],
    );
    const mapParcels = useMemo<MapParcel[]>(
        () => (view?.parcels ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            areaHa: p.areaHa ?? null,
            geometry: (p.geometry ?? null) as Geometry | null,
        })),
        [view],
    );
    const bounds = (view?.location?.boundsJson as [number, number, number, number] | null) ?? null;

    const mark = useCallback(
        async (line: Line, status: LineStatus) => {
            setError(null);
            // 1 — optimistic update of the local view (responds instantly,
            //     online OR offline) + persist the snapshot so a cold offline
            //     reload reflects work already queued.
            setView((prev) => {
                if (!prev) return prev;
                const next: FieldOpView = {
                    ...prev,
                    lines: prev.lines.map((l) => (l.id === line.id ? { ...l, status } : l)),
                    progress: {
                        total: prev.progress.total,
                        done: prev.lines.filter((l) =>
                            l.id === line.id ? status !== 'PENDING' : l.status !== 'PENDING',
                        ).length,
                    },
                };
                saveFieldSnapshot(taskId, next);
                return next;
            });
            // 2 — send-or-queue. A terminal failure (server rejected the
            //     mark) throws — revalidate to server truth and surface the
            //     error rather than leaving a phantom "Done" on screen.
            const label = `Mark ${line.parcel?.name ?? 'parcel'} ${status.toLowerCase()}`;
            try {
                const result = await submit({
                    url: buildUrl(`/field-operations/${taskId}/parcels/${line.id}`),
                    method: 'PATCH',
                    body: { status },
                    label,
                });
                // 3 — when it actually went out, revalidate against the server
                //     (picks up the job auto-resolve + any stock deduction);
                //     the SWR effect resyncs `view` + the snapshot.
                if (result === 'sent') await mutate();
            } catch {
                setError('Could not save that change — it was reverted. Please retry.');
                await mutate(); // revalidate → SWR effect discards the optimistic update
            }
        },
        [submit, buildUrl, taskId, mutate],
    );

    if (isLoading && !view) return <div className="p-6 text-base text-content-secondary">Loading field operation…</div>;
    if (!view) return <div className="p-6 text-base text-content-secondary">Field operation not found.</div>;

    return (
        <div className="mx-auto max-w-xl space-y-default p-4">
            {/* sync status bar */}
            <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-default px-3 py-2">
                <span className="flex items-center gap-compact text-sm">
                    <StatusBadge variant={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</StatusBadge>
                    {pending > 0 && <span className="text-content-secondary">{pending} queued</span>}
                </span>
                {pending > 0 && online && (
                    <Button variant="secondary" size="sm" onClick={() => void flush()}>Sync now</Button>
                )}
            </div>

            {error && (
                <div role="alert" className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                    {error}
                </div>
            )}

            <div>
                <Heading level={2}>{view.task.key ? `${view.task.key} · ` : ''}{view.task.title}</Heading>
                <p className="text-sm text-content-secondary">{view.progress.done} / {view.progress.total} parcels complete · {view.task.status}</p>
            </div>

            <MapCanvas parcels={mapParcels} bounds={bounds} interactive={false} doneIds={doneIds} className="h-[300px] w-full overflow-hidden rounded-lg border border-border-subtle" />

            <ul className="space-y-tight">
                {view.lines.map((l) => (
                    <li key={l.id} className="rounded-lg border border-border-subtle p-4">
                        <div className="mb-3">
                            <div className="text-base font-semibold">{l.parcel?.name ?? 'Parcel'}</div>
                            <div className="text-sm text-content-secondary">
                                {l.product?.name} · {String(l.doseValue)} {l.doseUnit?.symbol} · {l.parcel?.areaHa ?? '–'} ha
                            </div>
                        </div>
                        {l.status === 'PENDING' ? (
                            <div className="grid grid-cols-2 gap-compact">
                                <Button variant="primary" size="lg" onClick={() => void mark(l, 'DONE')}>Done</Button>
                                <Button variant="secondary" size="lg" onClick={() => void mark(l, 'SKIPPED')}>Skip</Button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between">
                                <StatusBadge variant={l.status === 'DONE' ? 'success' : 'neutral'}>{l.status}</StatusBadge>
                                <Button variant="secondary" size="sm" onClick={() => void mark(l, 'PENDING')}>Reopen</Button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default OfflineFieldPanel;
