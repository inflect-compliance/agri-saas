'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Tanstack-react-table cell callbacks (tanstack cell callbacks where row/getValue carry the implicit-any annotation) — typing each callback with `CellContext<TData, TValue>` requires importing the right generic per column and adds significant ceremony. The implicit any here is at the render-time boundary; row.original is type-narrowed by the column's accessorKey at runtime. */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, createColumns } from '@/components/ui/table';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface NotificationSettings {
    enabled: boolean;
    defaultFromName: string;
    defaultFromEmail: string;
    complianceMailbox: string | null;
}

interface OutboxStats {
    last24h: { pending: number; sent: number; failed: number };
    last7d: { pending: number; sent: number; failed: number };
    last30d: { pending: number; sent: number; failed: number };
}

export default function NotificationSettingsPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const [tab, setTab] = useState<'settings' | 'stats'>('settings');
    const [settings, setSettings] = useState<NotificationSettings | null>(null);
    const [stats, setStats] = useState<OutboxStats | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [runningJob, setRunningJob] = useState<'processOutbox' | 'dailySweep' | null>(null);

    const fetchData = useCallback(() => {
        fetch(apiUrl('/notification-settings'))
            .then(r => r.json())
            .then(data => {
                setSettings(data.settings);
                setStats(data.stats);
            })
            .catch(console.error);
    }, [apiUrl]);

    useEffect(() => { fetchData(); }, [fetchData]);

    async function handleRunJob(jobType: 'processOutbox' | 'dailySweep') {
        if (!confirm(`Are you sure you want to run the ${jobType} job now?`)) return;
        setRunningJob(jobType);
        try {
            const res = await fetch(apiUrl('/notification-settings/run-job'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobType }),
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Success: ${data.message}\n` + JSON.stringify(data.stats, null, 2));
                fetchData(); // Refresh stats
            } else {
                alert(`Error: ${data.error || 'Failed to trigger job'}`);
            }
        } finally {
            setRunningJob(null);
        }
    }

    async function handleSave() {
        if (!settings) return;
        setSaving(true);
        setSaved(false);
        try {
            const res = await fetch(apiUrl('/notification-settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const updated = await res.json();
            setSettings(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } finally {
            setSaving(false);
        }
    }

    if (!settings) return <div className="p-8"><div className="h-6 w-full sm:w-48 bg-bg-elevated rounded animate-pulse" /></div>;

    return (
        <div className="space-y-section animate-fadeIn">
            <div>
                <Breadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Admin', href: tenantHref('/admin') },
                        { label: 'Email Notifications' },
                    ]}
                    className="mb-1"
                />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-default">
                <div className="flex flex-wrap items-center gap-compact">
                    <Heading level={1}>Email Notifications</Heading>
                    <StatusBadge variant={settings.enabled ? 'success' : 'warning'}>
                        {settings.enabled ? 'Enabled' : 'Disabled'}
                    </StatusBadge>
                </div>
                <div className="flex items-center gap-compact">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRunJob('processOutbox')}
                        disabled={!!runningJob}
                        loading={runningJob === 'processOutbox'}
                        className="rounded-full"
                    >
                        {runningJob === 'processOutbox' ? 'Sending...' : 'Process Outbox Now'}
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRunJob('dailySweep')}
                        disabled={!!runningJob}
                        loading={runningJob === 'dailySweep'}
                        className="rounded-full"
                    >
                        {runningJob === 'dailySweep' ? 'Running...' : 'Run Daily Sweep'}
                    </Button>
                </div>
            </div>

            {/* Epic 60 — ToggleGroup replaces hand-rolled tab bar. */}
            <ToggleGroup
                ariaLabel="Notification admin view"
                options={[
                    { value: 'settings', label: 'Settings' },
                    { value: 'stats', label: 'Send Stats' },
                ]}
                selected={tab}
                selectAction={(v) => setTab(v as 'settings' | 'stats')}
            />

            {tab === 'settings' ? (
                <div className="glass-card p-6 space-y-5">
                    {/* Enable / Disable */}
                    <label className="flex items-center gap-compact cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.enabled}
                            onChange={e => setSettings({ ...settings, enabled: e.target.checked })}
                            className="toggle toggle-brand"
                        />
                        <span className="text-sm font-medium">Enable email notifications</span>
                    </label>

                    {/* From Name */}
                    <div>
                        <label className="block text-xs text-content-muted mb-1">Sender Name</label>
                        <input
                            type="text"
                            value={settings.defaultFromName}
                            onChange={e => setSettings({ ...settings, defaultFromName: e.target.value })}
                            className="input input-bordered w-full max-w-md"
                            placeholder="Inflect Compliance"
                        />
                    </div>

                    {/* From Email */}
                    <div>
                        <label className="block text-xs text-content-muted mb-1">Sender Email</label>
                        <input
                            type="email"
                            value={settings.defaultFromEmail}
                            onChange={e => setSettings({ ...settings, defaultFromEmail: e.target.value })}
                            className="input input-bordered w-full max-w-md"
                            placeholder="noreply@inflect.app"
                        />
                    </div>

                    {/* Compliance Mailbox */}
                    <div>
                        <label className="block text-xs text-content-muted mb-1">Compliance Mailbox (BCC)</label>
                        <input
                            type="email"
                            value={settings.complianceMailbox || ''}
                            onChange={e => setSettings({ ...settings, complianceMailbox: e.target.value || null })}
                            className="input input-bordered w-full max-w-md"
                            placeholder="compliance@yourcompany.com (optional)"
                        />
                        <p className="text-xs text-content-subtle mt-1">All outbound emails will be BCC&apos;d to this address.</p>
                    </div>

                    {/* Save */}
                    <div className="flex items-center gap-compact pt-2">
                        <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving}>
                            {saving ? 'Saving...' : 'Save Settings'}
                        </Button>
                        {saved && <span className="text-sm text-content-success">Saved successfully</span>}
                    </div>
                </div>
            ) : (
                <div className="glass-card p-6">
                    {stats ? (() => {
                        const statsColumns = createColumns<{ label: string; pending: number; sent: number; failed: number; total: number }>([
                            { accessorKey: 'label', header: 'Period', cell: ({ getValue }: any) => <span className="font-medium">{getValue()}</span> },
                            { accessorKey: 'pending', header: 'Pending', cell: ({ getValue }: any) => <StatusBadge variant="warning">{getValue()}</StatusBadge> },
                            { accessorKey: 'sent', header: 'Sent', cell: ({ getValue }: any) => <StatusBadge variant="success">{getValue()}</StatusBadge> },
                            { accessorKey: 'failed', header: 'Failed', cell: ({ getValue }: any) => <StatusBadge variant="error">{getValue()}</StatusBadge> },
                            { accessorKey: 'total', header: 'Total', cell: ({ getValue }: any) => <span className="text-content-muted">{getValue()}</span> },
                        ]);
                        const statsData = [
                            { label: 'Last 24 hours', ...stats.last24h, total: stats.last24h.pending + stats.last24h.sent + stats.last24h.failed },
                            { label: 'Last 7 days', ...stats.last7d, total: stats.last7d.pending + stats.last7d.sent + stats.last7d.failed },
                            { label: 'Last 30 days', ...stats.last30d, total: stats.last30d.pending + stats.last30d.sent + stats.last30d.failed },
                        ];
                        return (
                            <DataTable
                                data={statsData}
                                columns={statsColumns}
                                getRowId={(r) => r.label}
                                emptyState="No stats available"
                                resourceName={(p) => p ? 'periods' : 'period'}
                                data-testid="notification-stats-table"
                            />
                        );
                    })() : (
                        <p className="text-content-muted"><span className="inline-block h-4 w-full sm:w-32 bg-bg-elevated rounded animate-pulse" /></p>
                    )}
                </div>
            )}
        </div>
    );
}
