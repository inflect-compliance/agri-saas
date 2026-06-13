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
import { useCallback, useMemo } from 'react';
import type { Geometry } from 'geojson';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useOfflineSync } from '@/lib/offline/use-offline-sync';
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

    const doneIds = useMemo(
        () => (data?.lines ?? [])
            .filter((l) => l.status !== 'PENDING')
            .map((l) => l.parcel?.id)
            .filter((id): id is string => Boolean(id)),
        [data],
    );
    const mapParcels = useMemo<MapParcel[]>(
        () => (data?.parcels ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            areaHa: p.areaHa ?? null,
            geometry: (p.geometry ?? null) as Geometry | null,
        })),
        [data],
    );
    const bounds = (data?.location?.boundsJson as [number, number, number, number] | null) ?? null;

    const mark = useCallback(
        async (line: Line, status: LineStatus) => {
            // 1 — optimistic local update so the field UI responds instantly,
            //     online or off.
            await mutate(
                (prev) =>
                    prev
                        ? {
                              ...prev,
                              lines: prev.lines.map((l) => (l.id === line.id ? { ...l, status } : l)),
                              progress: {
                                  total: prev.progress.total,
                                  done: prev.lines.filter((l) =>
                                      l.id === line.id ? status !== 'PENDING' : l.status !== 'PENDING',
                                  ).length,
                              },
                          }
                        : prev,
                { revalidate: false },
            );
            // 2 — send-or-queue.
            const label = `Mark ${line.parcel?.name ?? 'parcel'} ${status.toLowerCase()}`;
            const result = await submit({
                url: buildUrl(`/field-operations/${taskId}/parcels/${line.id}`),
                method: 'PATCH',
                body: { status },
                label,
            });
            // 3 — when it actually went out, revalidate against the server
            //     (picks up the job auto-resolve + any stock deduction).
            if (result === 'sent') await mutate();
        },
        [mutate, submit, buildUrl, taskId],
    );

    if (isLoading && !data) return <div className="p-6 text-base text-content-secondary">Loading field operation…</div>;
    if (!data) return <div className="p-6 text-base text-content-secondary">Field operation not found.</div>;

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

            <div>
                <Heading level={2}>{data.task.key ? `${data.task.key} · ` : ''}{data.task.title}</Heading>
                <p className="text-sm text-content-secondary">{data.progress.done} / {data.progress.total} parcels complete · {data.task.status}</p>
            </div>

            <MapCanvas parcels={mapParcels} bounds={bounds} interactive={false} doneIds={doneIds} className="h-[300px] w-full overflow-hidden rounded-lg border border-border-subtle" />

            <ul className="space-y-tight">
                {data.lines.map((l) => (
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
