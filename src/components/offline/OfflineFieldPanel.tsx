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
import { OfflineSyncBar } from '@/components/offline/OfflineSyncBar';
import { PushOptIn } from '@/components/pwa/PushOptIn';
import { FadeIn } from '@/components/ui/motion/FadeIn';
import { haptic } from '@/lib/haptics';
import { AgStatusBadge } from '@/components/ag/ag-status';
import { Heading } from '@/components/ui/typography';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { useMediaQuery } from '@/components/ui/hooks';
import { cn } from '@/lib/cn';
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
    const { isMobile } = useMediaQuery();
    const { data, mutate, isLoading } = useTenantSWR<FieldOpView>(`/field-operations/${taskId}`);
    const { online, pending, submit, flush } = useOfflineSync();
    const [error, setError] = useState<string | null>(null);
    // Tapping a parcel on the map selects it and scrolls its prescription
    // line into view, so an operator can jump straight to the line they're
    // standing on instead of scrolling the list.
    const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
    // Per-line in-flight marker → inline spinner (never a blocking modal).
    const [markingId, setMarkingId] = useState<string | null>(null);

    const selectParcel = useCallback((ids: string[]) => {
        const id = ids[ids.length - 1] ?? null;
        setSelectedParcelId(id);
        if (id) {
            document
                .getElementById(`offline-line-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, []);

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
            setMarkingId(line.id);
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
                if (result === 'sent') {
                    // Online confirmation (the offline/queued path already
                    // fired a tap haptic in useOfflineSync). A done feels
                    // weightier than a skip/reopen.
                    haptic(status === 'DONE' ? 'success' : 'tap');
                    await mutate();
                }
            } catch {
                setError('Could not save that change — it was reverted. Please retry.');
                haptic('error');
                await mutate(); // revalidate → SWR effect discards the optimistic update
            } finally {
                setMarkingId(null);
            }
        },
        [submit, buildUrl, taskId, mutate],
    );

    if (isLoading && !view) return <div className="p-6 text-base text-content-secondary">Loading field operation…</div>;
    if (!view) return <div className="p-6 text-base text-content-secondary">Field operation not found.</div>;

    return (
        // Content cross-fades in once the field op loads (skeleton/loader →
        // content), on the sanctioned animate-fade-in token.
        <FadeIn className="mx-auto max-w-xl space-y-default p-4">
            {/* sync status bar (shared across offline-capable surfaces) */}
            <OfflineSyncBar online={online} pending={pending} onSyncNow={() => void flush()} />

            {error && (
                <div role="alert" className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                    {error}
                </div>
            )}

            <div className="flex items-start justify-between gap-default">
                <div className="min-w-0">
                    <Heading level={2}>{view.task.key ? `${view.task.key} · ` : ''}{view.task.title}</Heading>
                    <p className="text-sm text-content-secondary">{view.progress.done} / {view.progress.total} parcels complete · {view.task.status}</p>
                </div>
                <PushOptIn className="shrink-0" />
            </div>

            {/* The map is the operator's primary view: full-bleed and tall
                on phones (was a fixed 300px box), edge-to-edge so the field
                fills the screen. Tapping a parcel selects + scrolls to its
                line. Locate-me helps confirm which parcel they're standing in. */}
            <MapCanvas
                parcels={mapParcels}
                bounds={bounds}
                interactive
                selectedIds={selectedParcelId ? [selectedParcelId] : []}
                onSelectionChange={selectParcel}
                doneIds={doneIds}
                showControls
                flyToOnSelect
                controlsBottomInset={isMobile ? 76 : 12}
                className={isMobile
                    ? '-mx-4 h-[60vh] min-h-[20rem] overflow-hidden border-y border-border-subtle'
                    : 'h-[360px] w-full overflow-hidden rounded-lg border border-border-subtle'}
            />

            <ul className="space-y-tight">
                {view.lines.map((l) => (
                    <li
                        key={l.id}
                        id={l.parcel?.id ? `offline-line-${l.parcel.id}` : undefined}
                        className={cn(
                            // list-add: each line fades in on mount (one-shot)
                            'animate-fade-in rounded-lg border p-4 transition-colors',
                            l.parcel?.id && l.parcel.id === selectedParcelId
                                ? 'border-border-emphasis ring-2 ring-ring'
                                : 'border-border-subtle',
                        )}
                    >
                        <div className="mb-3">
                            <div className="text-base font-semibold">{l.parcel?.name ?? 'Parcel'}</div>
                            <div className="text-sm text-content-secondary">
                                {l.product?.name} · {String(l.doseValue)} {l.doseUnit?.symbol} · {l.parcel?.areaHa ?? '–'} ha
                            </div>
                        </div>
                        {l.status === 'PENDING' ? (
                            <div className="grid grid-cols-2 gap-compact">
                                <Button variant="primary" size="lg" loading={markingId === l.id} disabled={markingId === l.id} onClick={() => void mark(l, 'DONE')}>Done</Button>
                                <Button variant="secondary" size="lg" loading={markingId === l.id} disabled={markingId === l.id} onClick={() => void mark(l, 'SKIPPED')}>Skip</Button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between">
                                <AgStatusBadge entity="operationParcel" status={l.status} size="md" />
                                <Button variant="secondary" size="sm" loading={markingId === l.id} disabled={markingId === l.id} onClick={() => void mark(l, 'PENDING')}>Reopen</Button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </FadeIn>
    );
}

export default OfflineFieldPanel;
