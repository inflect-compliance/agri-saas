'use client';

/**
 * FieldOperationPanel — the operator's view of a spray job. A read-only
 * parcel map (completed parcels shaded green) plus a per-parcel
 * prescription checklist with mark-done / skip / reopen actions. The
 * job auto-resolves server-side once every line is DONE/SKIPPED.
 *
 * Rendered both on the Task detail page (FIELD_OPERATION tasks) and the
 * Location "Operations" tab.
 */
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import type { Geometry } from 'geojson';
import { Button } from '@/components/ui/button';
import { AgStatusBadge } from '@/components/ag/ag-status';
import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { apiPatch } from '@/lib/api-client';
import { totalLabel } from '@/lib/agro/rate-calc';
import { haptic } from '@/lib/haptics';
import { playSound } from '@/lib/sound';
import { SprayJobCompletionCard } from '@/components/ui/map/SprayJobCompletionCard';
import type { MapParcel } from '@/components/ui/map/MapCanvas';

// Browser-only (MapLibre touches window) — load client-side only.
const MapCanvas = dynamic(() => import('@/components/ui/map/MapCanvas').then((m) => m.MapCanvas), { ssr: false });

interface Line {
    id: string;
    status: 'PENDING' | 'DONE' | 'SKIPPED';
    doseValue: string | number;
    waterRateValue?: string | number | null;
    parcel?: { id: string; name: string; areaHa?: number | null } | null;
    product?: { id: string; name: string } | null;
    doseUnit?: { id: string; symbol: string } | null;
    waterRateUnit?: { id: string; symbol: string } | null;
}
interface FieldOpView {
    task: { id: string; key?: string | null; title: string; status: string };
    lines: Line[];
    parcels: Array<{ id: string; name: string; areaHa?: number | null; geometry: unknown }>;
    location: { id: string; name: string; boundsJson: unknown } | null;
    progress: { total: number; done: number };
}

export interface FieldOperationPanelProps {
    taskId: string;
}

export function FieldOperationPanel({ taskId }: FieldOperationPanelProps) {
    const buildUrl = useTenantApiUrl();
    const { data, mutate, isLoading } = useTenantSWR<FieldOpView>(`/field-operations/${taskId}`);
    const [busyId, setBusyId] = useState<string | null>(null);

    const doneIds = useMemo(
        () => (data?.lines ?? [])
            .filter((l) => l.status === 'DONE' || l.status === 'SKIPPED')
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

    const mark = async (lineId: string, status: 'DONE' | 'SKIPPED' | 'PENDING') => {
        setBusyId(lineId);
        try {
            await apiPatch(buildUrl(`/field-operations/${taskId}/parcels/${lineId}`), { status });
            // Sensory confirmation — a DONE feels weightier than a skip/reopen.
            const kind = status === 'DONE' ? 'success' : 'tap';
            haptic(kind);
            playSound(kind);
            await mutate();
        } catch (err) {
            haptic('error');
            throw err;
        } finally {
            setBusyId(null);
        }
    };

    if (isLoading && !data) return <div className="text-sm text-content-secondary">Loading field operation…</div>;
    if (!data) return <div className="text-sm text-content-secondary">Field operation not found.</div>;

    // Spray-job complete → offer a shareable card. Area covered = the done
    // parcels' hectarage; the job's product is shared across its lines.
    const allComplete = data.progress.total > 0 && data.progress.done === data.progress.total;
    const areaCovered = data.lines
        .filter((l) => l.status === 'DONE')
        .reduce((sum, l) => sum + (l.parcel?.areaHa ?? 0), 0);
    const jobProduct = data.lines.find((l) => l.product?.name)?.product?.name ?? null;

    return (
        <div className="space-y-section">
            {allComplete && (
                <SprayJobCompletionCard
                    title={data.task.title}
                    parcelsDone={data.progress.done}
                    areaCoveredHa={areaCovered}
                    productName={jobProduct}
                />
            )}
            <div className="flex items-center justify-between">
                <div className="text-sm text-content-secondary">
                    {data.progress.done} / {data.progress.total} parcels complete
                </div>
                <div className="text-sm font-medium">{data.task.status}</div>
            </div>
            <MapCanvas parcels={mapParcels} bounds={bounds} interactive={false} doneIds={doneIds} className="h-[360px] w-full overflow-hidden rounded-lg border border-border-subtle" />
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                {data.lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-default px-4 py-3">
                        <div>
                            <div className="text-sm font-medium">{l.parcel?.name ?? 'Parcel'}</div>
                            <div className="text-xs text-content-secondary">
                                {l.product?.name} · {String(l.doseValue)} {l.doseUnit?.symbol} · {l.parcel?.areaHa ?? '–'} ha
                            </div>
                            {/* Amounts needed for THIS parcel — rate × its area
                                (per the unit's /ha or /dca basis). */}
                            {l.parcel?.areaHa != null && l.doseUnit?.symbol && (
                                <div className="text-xs font-medium text-content-emphasis tabular-nums">
                                    Needs {totalLabel(Number(l.doseValue), l.doseUnit.symbol, l.parcel.areaHa)}
                                    {l.waterRateValue != null && l.waterRateUnit?.symbol && (
                                        <> · {totalLabel(Number(l.waterRateValue), l.waterRateUnit.symbol, l.parcel.areaHa)} water</>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-tight">
                            <AgStatusBadge entity="operationParcel" status={l.status} />
                            {l.status === 'PENDING' ? (
                                <>
                                    <Button size="sm" variant="primary" loading={busyId === l.id} disabled={busyId === l.id} onClick={() => mark(l.id, 'DONE')}>Done</Button>
                                    <Button size="sm" variant="secondary" loading={busyId === l.id} disabled={busyId === l.id} onClick={() => mark(l.id, 'SKIPPED')}>Skip</Button>
                                </>
                            ) : (
                                <Button size="sm" variant="secondary" loading={busyId === l.id} disabled={busyId === l.id} onClick={() => mark(l.id, 'PENDING')}>Reopen</Button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default FieldOperationPanel;
