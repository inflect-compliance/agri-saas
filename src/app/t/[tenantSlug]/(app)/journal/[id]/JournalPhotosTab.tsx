'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImageIcon, Trash, CloudUpload, NucleoPhoto } from '@/components/ui/icons/nucleo';
import { EmptyState } from '@/components/ui/empty-state';
import { apiDelete } from '@/lib/api-client';
import { useToastWithUndo } from '@/components/ui/hooks';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/cn';
import { cardVariants } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format-date';

interface PhotoLink {
    id: string;
    caption?: string | null;
    createdAt: string;
    fileRecord?: { id: string; originalName?: string } | null;
}

interface JournalPhotosTabProps {
    entryId: string;
    photos: PhotoLink[];
    apiUrl: (path: string) => string;
    canWrite: boolean;
    onChanged: () => void;
}

/**
 * Photos tab — photo logging (HortusFox-style). Upload streams a
 * multipart POST to /journal/{id}/files, which creates the FileRecord
 * through the shared storage pipeline and links it via LogEntryFile.
 * Detach uses the Epic 67 undo-toast (5s delayed commit).
 */
export function JournalPhotosTab({ entryId, photos, apiUrl, canWrite, onChanged }: JournalPhotosTabProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Instant local preview of the just-captured photo — an object-URL so
    // it renders immediately, before (and even without) any upload, which
    // keeps the camera flow responsive offline. Revoked on replace/unmount.
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const triggerUndoToast = useToastWithUndo();

    useEffect(() => {
        return () => {
            if (previewSrc) URL.revokeObjectURL(previewSrc);
        };
    }, [previewSrc]);

    const onPick = () => fileInputRef.current?.click();
    const onPickCamera = () => cameraInputRef.current?.click();

    const uploadFile = async (file: File) => {
        setUploading(true);
        setError(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch(apiUrl(`/journal/${entryId}/files`), {
                method: 'POST',
                body: fd,
            });
            if (!res.ok) {
                let msg = `Upload failed (${res.status})`;
                try {
                    const body = await res.json();
                    msg = body?.error?.message || body?.error || msg;
                } catch {
                    /* keep default */
                }
                throw new Error(typeof msg === 'string' ? msg : 'Upload failed');
            }
            haptic('success');
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
            haptic('error');
        } finally {
            setUploading(false);
        }
    };

    const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset the input so picking the same file again re-fires onChange.
        e.target.value = '';
        if (!file) return;
        await uploadFile(file);
    };

    const onPhotoCaptured = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        // Crisp tactile confirmation the shutter captured (field + gloves).
        haptic('tap');
        // Show the thumbnail instantly (offline-safe), then upload.
        setPreviewSrc((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
        });
        await uploadFile(file);
    };

    const detach = (fileRecordId: string, label: string) => {
        // Optimistic removal happens via the parent refetch after commit;
        // the undo window holds the destructive DELETE for 5 seconds.
        triggerUndoToast({
            message: `Photo removed`,
            undoMessage: 'Undo',
            action: async () => {
                await apiDelete(apiUrl(`/journal/${entryId}/files?fileRecordId=${encodeURIComponent(fileRecordId)}`));
                onChanged();
            },
            onError: () => setError(`Failed to remove ${label}`),
        });
    };

    return (
        <div className={cn(cardVariants(), 'space-y-default')} id="journal-photos">
            {error && (
                <div
                    className="rounded-lg border border-border-error bg-bg-error px-3 py-2 text-sm text-content-error"
                    role="alert"
                >
                    {error}
                </div>
            )}

            {canWrite && (
                <div className="flex flex-wrap items-center justify-between gap-default">
                    <span className="text-sm text-content-muted">
                        Attach field photos and documents to this entry.
                    </span>
                    <div className="flex items-center gap-compact">
                        {/* Camera capture — opens the phone's rear camera on
                            mobile (capture="environment"). Desktop falls back
                            to a normal image file picker. */}
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<NucleoPhoto className="size-4" />}
                            onClick={onPickCamera}
                            loading={uploading}
                            disabled={uploading}
                            id="journal-photo-capture"
                        >
                            Take photo
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<CloudUpload className="size-4" />}
                            onClick={onPick}
                            loading={uploading}
                            disabled={uploading}
                            id="journal-photo-upload"
                        >
                            Upload
                        </Button>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*,application/pdf"
                        onChange={onFileChosen}
                        aria-hidden="true"
                    />
                    <input
                        ref={cameraInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={onPhotoCaptured}
                        aria-hidden="true"
                    />
                </div>
            )}

            {previewSrc && (
                <div className="flex items-center gap-default rounded-lg border border-border-subtle p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object-URL preview of a just-captured photo; next/image needs known dimensions + a remote allowlist that a transient blob URL can't satisfy. */}
                    <img
                        src={previewSrc}
                        alt="Just captured"
                        className="size-16 shrink-0 rounded-md object-cover"
                    />
                    <span className="text-xs text-content-muted">
                        {uploading ? 'Uploading photo…' : 'Photo captured.'}
                    </span>
                </div>
            )}

            {photos.length === 0 ? (
                <EmptyState
                    size="sm"
                    variant="no-records"
                    title="No photos yet"
                    description={canWrite ? 'Upload a photo to start the visual record.' : 'No photos have been attached to this entry.'}
                />
            ) : (
                <ul className="divide-y divide-border-subtle">
                    {photos.map((p) => {
                        const fileId = p.fileRecord?.id ?? '';
                        const name = p.fileRecord?.originalName ?? 'file';
                        return (
                            <li key={p.id} className="flex items-center justify-between gap-default py-2">
                                <a
                                    href={apiUrl(`/evidence/files/${fileId}/download`)}
                                    className="inline-flex min-w-0 items-center gap-tight text-sm text-content-link hover:underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <ImageIcon className="size-4 shrink-0 text-content-muted" aria-hidden="true" />
                                    <span className="min-w-0 truncate">{p.caption || name}</span>
                                </a>
                                <div className="flex items-center gap-tight">
                                    <span className="text-xs text-content-subtle whitespace-nowrap">
                                        {formatDateTime(p.createdAt)}
                                    </span>
                                    {canWrite && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => detach(fileId, name)}
                                            aria-label={`Remove ${name}`}
                                        >
                                            <Trash className="size-4" />
                                        </Button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
