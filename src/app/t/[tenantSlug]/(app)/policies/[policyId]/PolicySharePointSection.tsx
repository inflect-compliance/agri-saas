'use client';

/**
 * SP-4 — "Link to SharePoint" section on the policy detail page.
 * Link (single-select picker) / push / pull / unlink, with a conflict warning
 * when the SharePoint copy is newer than the last sync.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Heading } from '@/components/ui/typography';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import {
    SharePointFilePicker,
    type SpPickedItem,
} from '@/components/integrations/sharepoint/SharePointFilePicker';

interface SpStatus {
    linked: boolean;
    webUrl: string | null;
    conflict: boolean;
}

export function PolicySharePointSection({ policyId }: { policyId: string }) {
    const t = useTranslations('policies.sharepoint');
    const apiUrl = useTenantApiUrl();
    const [connId, setConnId] = useState<string | null>(null);
    const [status, setStatus] = useState<SpStatus | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const loadStatus = useCallback(async () => {
        try {
            const res = await fetch(apiUrl(`/policies/${policyId}/sharepoint`));
            if (res.ok) setStatus(await res.json());
        } catch {
            /* ignore */
        }
    }, [apiUrl, policyId]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(apiUrl('/integrations/sharepoint/connections'));
                if (res.ok) {
                    const conns = (await res.json()) as Array<{ id: string }>;
                    if (!cancelled) setConnId(conns[0]?.id ?? null);
                }
            } catch {
                /* SharePoint optional */
            }
        })();
        void loadStatus();
        return () => { cancelled = true; };
    }, [apiUrl, loadStatus]);

    const link = useCallback(
        async (items: SpPickedItem[]) => {
            if (!connId || items.length === 0) return;
            setBusy(true);
            setMsg(null);
            try {
                const res = await fetch(apiUrl(`/policies/${policyId}/sharepoint`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connectionId: connId, driveId: items[0].driveId, itemId: items[0].itemId }),
                });
                if (!res.ok) { setMsg(t('linkFailed')); return; }
                await loadStatus();
            } finally {
                setBusy(false);
            }
        },
        [apiUrl, connId, policyId, loadStatus],
    );

    const act = useCallback(
        async (path: string, method: string, okMsg: string) => {
            setBusy(true);
            setMsg(null);
            try {
                const res = await fetch(apiUrl(`/policies/${policyId}/sharepoint${path}`), { method });
                if (!res.ok) { setMsg(t('actionFailed')); return; }
                setMsg(okMsg);
                await loadStatus();
            } finally {
                setBusy(false);
            }
        },
        [apiUrl, policyId, loadStatus],
    );

    // SharePoint not configured for the tenant → render nothing.
    if (!connId) return null;

    return (
        <Card className="space-y-default p-6">
            <SharePointFilePicker
                showModal={pickerOpen}
                setShowModal={setPickerOpen}
                connectionId={connId}
                multiple={false}
                onConfirm={link}
            />
            <div className="flex items-center justify-between">
                <Heading level={3}>{t('heading')}</Heading>
                {status?.linked ? (
                    <StatusBadge variant="success">{t('linked')}</StatusBadge>
                ) : (
                    <StatusBadge variant="neutral">{t('notLinked')}</StatusBadge>
                )}
            </div>

            {status?.conflict && (
                <InlineNotice variant="warning">
                    {t('conflict')}
                </InlineNotice>
            )}
            {msg && <InlineNotice variant="success">{msg}</InlineNotice>}

            {status?.linked ? (
                <div className="flex flex-wrap items-center gap-tight">
                    {status.webUrl && (
                        <a
                            href={status.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-content-link"
                        >
                            {t('viewInSharePoint')}
                        </a>
                    )}
                    <div className="ml-auto flex gap-tight">
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('/push', 'POST', t('pushed'))}>
                            {t('push')}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('/pull', 'POST', t('pulled'))}>
                            {t('pull')}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('', 'DELETE', t('unlinked'))}>
                            {t('unlink')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-default">
                    <p className="text-sm text-content-muted">
                        {t('linkPrompt')}
                    </p>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPickerOpen(true)}>
                        {t('linkDocument')}
                    </Button>
                </div>
            )}
        </Card>
    );
}
