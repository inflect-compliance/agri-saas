'use client';

/**
 * SP-5 / SP-F1 — "Export to SharePoint" for a frozen audit pack. Picks a
 * destination FOLDER via the shared file picker (folder-select mode) and
 * uploads the pack ZIP there; shows the resulting link.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/inline-notice';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { SharePointFilePicker } from '@/components/integrations/sharepoint/SharePointFilePicker';

export function SharePointExportButton({ packId }: { packId: string }) {
    const t = useTranslations('audits');
    const apiUrl = useTenantApiUrl();
    const [available, setAvailable] = useState<boolean | null>(null);
    const [connId, setConnId] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(apiUrl('/integrations/sharepoint/connections'));
                if (!res.ok) { if (!cancelled) setAvailable(false); return; }
                const conns = (await res.json()) as Array<{ id: string }>;
                if (cancelled) return;
                setAvailable(conns.length > 0);
                setConnId(conns[0]?.id ?? '');
            } catch {
                if (!cancelled) setAvailable(false);
            }
        })();
        return () => { cancelled = true; };
    }, [apiUrl]);

    const exportTo = useCallback(
        async (driveId: string, folderId?: string) => {
            setBusy(true);
            setError(null);
            setResultUrl(null);
            try {
                const res = await fetch(apiUrl(`/audits/packs/${packId}/sharepoint-export`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connectionId: connId, driveId, folderId }),
                });
                if (!res.ok) { setError(t('exportFailed')); return; }
                const data = await res.json();
                setResultUrl(data.webUrl || null);
            } catch {
                setError(t('exportFailedNetwork'));
            } finally {
                setBusy(false);
            }
        },
        [apiUrl, connId, packId, t],
    );

    if (available === false) return null;

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                disabled={busy || !connId}
                onClick={() => setPickerOpen(true)}
                id="sp-export-pack-btn"
            >
                {busy ? t('exporting') : t('exportToSharePoint')}
            </Button>
            {connId && (
                <SharePointFilePicker
                    showModal={pickerOpen}
                    setShowModal={setPickerOpen}
                    connectionId={connId}
                    folderSelect
                    onConfirm={() => {}}
                    onConfirmFolder={({ driveId, folderId }) => void exportTo(driveId, folderId)}
                />
            )}
            {resultUrl && (
                <InlineNotice variant="success">
                    {t('exported')}{' '}
                    <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-content-link">
                        {t('viewInSharePoint')}
                    </a>
                </InlineNotice>
            )}
            {error && <InlineNotice variant="error">{error}</InlineNotice>}
        </>
    );
}
