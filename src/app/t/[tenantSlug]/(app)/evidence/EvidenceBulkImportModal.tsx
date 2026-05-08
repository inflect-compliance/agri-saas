'use client';

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic 43.3 — Bulk evidence import modal.
 *
 * Sits next to the single-file `<UploadEvidenceModal>` and drives the
 * ZIP bulk-import flow:
 *
 *   1. Operator drops a .zip into the FileDropzone (single-file mode,
 *      multi-zip uploads aren't a feature this prompt invents).
 *   2. POST `/evidence/imports` stages the archive + enqueues the
 *      `evidence-import` BullMQ job. Response carries `jobId`.
 *   3. We poll `GET /evidence/imports/:jobId` every 2s. Live progress
 *      surfaces extracted / skipped / errored counters as the worker
 *      iterates entries (BullMQ progress channel).
 *   4. On completion, invalidate the evidence query so the list
 *      shows the newly imported rows + close the modal.
 *
 * No business logic lives here — every safety bound is enforced by
 * the worker. The modal is a thin coordinator + status surface.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSWRConfig } from 'swr';
import { CACHE_KEYS } from '@/lib/swr-keys';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';

import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
    FileDropzone,
    type FileDropzoneHandle,
} from '@/components/ui/FileDropzone';
import { queryKeys } from '@/lib/queryKeys';
import {
    uploadWithProgress,
    UploadHttpError,
} from '@/lib/upload/upload-with-progress';

const POLL_INTERVAL_MS = 2000;

interface ImportProgress {
    extracted: number;
    skipped: number;
    errored: number;
    totalEntries: number;
}

interface ImportStatus {
    jobId: string;
    state:
        | 'waiting'
        | 'active'
        | 'completed'
        | 'failed'
        | 'delayed'
        | 'paused';
    progress?: ImportProgress | number;
    result?: {
        success?: boolean;
        details?: {
            extracted?: number;
            skipped?: number;
            errored?: number;
            evidenceIds?: string[];
            firstError?: string;
            skipReasons?: Array<{ path: string; reason: string }>;
        };
        errorMessage?: string;
    } | null;
    failedReason?: string | null;
}

export interface EvidenceBulkImportModalProps {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    tenantSlug: string;
    apiUrl: (path: string) => string;
}

export function EvidenceBulkImportModal({
    open,
    setOpen,
    tenantSlug,
    apiUrl,
}: EvidenceBulkImportModalProps) {
    const close = useCallback(() => setOpen(false), [setOpen]);
    const queryClient = useQueryClient();
    // Epic 69 — bridge cache invalidation to SWR (EvidenceClient
    // now reads from `useTenantSWR(CACHE_KEYS.evidence.list())`).
    const { mutate: swrMutate } = useSWRConfig();
    const dropzoneRef = useRef<FileDropzoneHandle>(null);

    const [error, setError] = useState('');
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<ImportStatus | null>(null);
    const [queuedCount, setQueuedCount] = useState(0);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setError('');
        setJobId(null);
        setStatus(null);
        setQueuedCount(0);
        setBusy(false);
    }, [open]);

    // Poll loop — runs only while a jobId is set + the job is not
    // terminal. Cleared on close + on terminal-state observation.
    useEffect(() => {
        if (!jobId) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const res = await fetch(
                    apiUrl(`/evidence/imports/${jobId}`),
                );
                if (!res.ok) return;
                const next = (await res.json()) as ImportStatus;
                if (cancelled) return;
                setStatus(next);
                if (
                    next.state === 'completed' ||
                    next.state === 'failed'
                ) {
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.evidence.all(tenantSlug),
                    });
                    // Bridge to the SWR cache the list page reads from.
                    const evidenceUrlPrefix = apiUrl(CACHE_KEYS.evidence.list());
                    swrMutate(
                        (key) =>
                            typeof key === 'string' &&
                            (key === evidenceUrlPrefix ||
                                key.startsWith(`${evidenceUrlPrefix}?`)),
                        undefined,
                        { revalidate: true },
                    );
                    return; // stop polling
                }
                setTimeout(tick, POLL_INTERVAL_MS);
            } catch {
                // Network blip — try again next tick.
                setTimeout(tick, POLL_INTERVAL_MS);
            }
        };
        tick();
        return () => {
            cancelled = true;
        };
    }, [jobId, apiUrl, queryClient, tenantSlug, swrMutate]);

    const mutation = useMutation({
        mutationFn: async (vars: {
            file: File;
            onProgress: (percent: number | null) => void;
            signal: AbortSignal;
        }) => {
            const formData = new FormData();
            formData.append('file', vars.file);
            const res = await uploadWithProgress<{ jobId: string }>(
                apiUrl('/evidence/imports'),
                formData,
                {
                    onProgress: (p) => vars.onProgress(p.percent),
                    signal: vars.signal,
                },
            );
            return res;
        },
        onSuccess: (data) => {
            if (data?.jobId) setJobId(data.jobId);
        },
        onError: (err) => {
            const msg =
                err instanceof UploadHttpError
                    ? (() => {
                          const body = err.parsedBody as
                              | { error?: string; message?: string }
                              | null;
                          return body?.error || body?.message || err.message;
                      })()
                    : err instanceof Error
                      ? err.message
                      : 'Bulk import failed';
            setError(msg);
            setBusy(false);
        },
    });

    const onUpload = useCallback(
        async (
            file: File,
            ctx: {
                onProgress: (p: number | null) => void;
                signal: AbortSignal;
            },
        ) => mutation.mutateAsync({ file, ...ctx }),
        [mutation],
    );

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setError('');
        setBusy(true);
        dropzoneRef.current?.startAll().catch(() => {
            // mutation onError surfaces the message
        });
    };

    const cancel = () => {
        if (busy && !jobId) {
            dropzoneRef.current?.cancelAll();
        }
        close();
    };

    const progress =
        status?.progress && typeof status.progress === 'object'
            ? (status.progress as ImportProgress)
            : null;
    const result = status?.result?.details ?? null;
    const isTerminal =
        status?.state === 'completed' || status?.state === 'failed';

    return (
        <Modal
            showModal={open}
            setShowModal={setOpen}
            size="md"
            title="Bulk import evidence"
            description="Upload a ZIP of evidence files to extract into individual evidence records."
            preventDefaultClose={busy && !isTerminal}
        >
            <Modal.Header
                title="Bulk import evidence"
                description="Drop a .zip and the worker will extract each supported file into its own evidence record."
            />
            <Modal.Form id="bulk-import-form" onSubmit={handleSubmit}>
                <Modal.Body>
                    {error && (
                        <div
                            className="mb-4 rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                            id="bulk-import-error"
                            role="alert"
                            data-testid="evidence-bulk-import-error"
                        >
                            {error}
                        </div>
                    )}

                    <FileDropzone
                        ref={dropzoneRef}
                        inputId="bulk-import-input"
                        accept=".zip,application/zip"
                        multiple={false}
                        autoStart={false}
                        maxFileSizeMB={100}
                        disabled={busy}
                        onPick={(files) => {
                            setQueuedCount(files.length);
                            setError('');
                        }}
                        onUpload={onUpload}
                        title="Drop a .zip"
                        hint="Up to 100 MB per archive. PDF / Office / image / CSV / JSON entries are extracted; other entries are skipped."
                    />

                    {jobId && (
                        <div
                            className="mt-4 rounded-lg border border-border-default bg-bg-subtle p-3 text-sm"
                            data-testid="evidence-bulk-import-status"
                        >
                            <p className="text-content-emphasis">
                                Job <span className="font-mono">{jobId}</span>{' '}
                                — {status?.state ?? 'queued'}
                            </p>
                            {progress && (
                                <p className="mt-1 text-xs text-content-muted">
                                    {progress.extracted} extracted ·{' '}
                                    {progress.skipped} skipped ·{' '}
                                    {progress.errored} errored ·{' '}
                                    {progress.totalEntries} total entries
                                </p>
                            )}
                            {isTerminal && result && (
                                <ul className="mt-2 space-y-0.5 text-xs">
                                    <li className="text-content-success">
                                        Extracted: {result.extracted ?? 0}
                                    </li>
                                    <li className="text-content-warning">
                                        Skipped: {result.skipped ?? 0}
                                    </li>
                                    <li className="text-content-error">
                                        Errored: {result.errored ?? 0}
                                    </li>
                                    {result.firstError && (
                                        <li className="text-content-error">
                                            First error: {result.firstError}
                                        </li>
                                    )}
                                </ul>
                            )}
                            {status?.state === 'failed' && (
                                <p className="mt-2 text-xs text-content-error">
                                    {status.failedReason ?? 'Job failed'}
                                </p>
                            )}
                        </div>
                    )}
                </Modal.Body>

                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        id="bulk-import-cancel-btn"
                        onClick={cancel}
                    >
                        {isTerminal ? 'Close' : 'Cancel'}
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        id="bulk-import-submit-btn"
                        disabled={
                            queuedCount === 0 || busy || jobId !== null
                        }
                    >
                        {jobId
                            ? 'Import running…'
                            : busy
                              ? 'Uploading…'
                              : 'Start import'}
                    </Button>
                </Modal.Actions>
            </Modal.Form>
        </Modal>
    );
}
