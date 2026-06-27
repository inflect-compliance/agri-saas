'use client';

/**
 * SpatialImportModal — upload a parcel-boundary file (shapefile .zip /
 * KML / GeoJSON) into a Location. Posts multipart/form-data to the
 * spatial-import route; existing parcels are replaced.
 *
 * The import is processed OFF the request thread (abuse hardening): the
 * POST stages the file + enqueues a job (202 + jobId), then this modal
 * polls the per-job status route until the parse + validate + persist
 * completes. A per-format/complexity/topology rejection surfaces as the
 * job's `failedReason`.
 */
import { useState, type Dispatch, type SetStateAction } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export interface SpatialImportModalProps {
    locationId: string;
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    onImported?: (result: { parcelCount: number; format: string; skipped: number }) => void;
}

interface JobStatus {
    state: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed' | 'unknown' | string;
    result?: { details?: { parcelCount?: number; format?: string; skipped?: number } } | null;
    failedReason?: string | null;
}

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 90; // ~90s ceiling — comfortably past the 30s parse budget.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function SpatialImportModal({ locationId, open, setOpen, onImported }: SpatialImportModalProps) {
    const buildUrl = useTenantApiUrl();
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Poll the job status route until the import completes or fails. */
    const pollUntilDone = async (jobId: string): Promise<JobStatus> => {
        for (let i = 0; i < MAX_POLLS; i++) {
            await sleep(POLL_INTERVAL_MS);
            const res = await fetch(buildUrl(`/locations/${locationId}/spatial-import/${jobId}`));
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error?.message || body?.error || `Status check failed (${res.status})`);
            }
            const status = (await res.json()) as JobStatus;
            if (status.state === 'completed') return status;
            if (status.state === 'failed') {
                throw new Error(status.failedReason || 'Import failed during processing.');
            }
        }
        throw new Error('Import is taking longer than expected. Check the location shortly.');
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setError('Choose a file first.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch(buildUrl(`/locations/${locationId}/spatial-import`), { method: 'POST', body: fd });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error?.message || body?.error || `Import failed (${res.status})`);
            }
            // 202 Accepted → poll the job to completion.
            const { jobId } = await res.json();
            const status = await pollUntilDone(jobId);
            const details = status.result?.details ?? {};
            onImported?.({
                parcelCount: details.parcelCount ?? 0,
                format: details.format ?? '',
                skipped: details.skipped ?? 0,
            });
            setOpen(false);
            setFile(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="md"
            title="Import parcels"
            description="Upload a shapefile (.zip), KML, or GeoJSON. Existing parcels are replaced."
            preventDefaultClose={busy}
        >
            <Modal.Header title="Import parcels" description="Upload a shapefile (.zip), KML, or GeoJSON. Existing parcels are replaced." />
            <Modal.Form id="spatial-import-form" onSubmit={submit}>
                <Modal.Body>
                    {error && (
                        <div role="alert" className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error">
                            {error}
                        </div>
                    )}
                    <FormField label="Spatial file" required description="Accepted: .zip (shapefile), .kml/.kmz, .geojson/.json">
                        <input
                            type="file"
                            accept=".zip,.kml,.kmz,.geojson,.json"
                            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                            className="block w-full text-sm text-content-secondary file:mr-3 file:rounded-md file:border file:border-border-subtle file:bg-bg-subtle file:px-3 file:py-1.5 file:text-sm"
                        />
                    </FormField>
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!file || busy}>
                        {busy ? 'Importing…' : 'Import'}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}

export default SpatialImportModal;
