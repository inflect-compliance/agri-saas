'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable @typescript-eslint/no-explicit-any -- Tanstack-react-table cell callbacks (tanstack cell callbacks where row/getValue carry the implicit-any annotation) — typing each callback with `CellContext<TData, TValue>` requires importing the right generic per column and adds significant ceremony. The implicit any here is at the render-time boundary; row.original is type-narrowed by the column's accessorKey at runtime. */
import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { ArrowLeft, Plus, Trash2, CheckCircle, XCircle, Loader2, Link2, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Combobox } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { DataTable, createColumns } from '@/components/ui/table';

interface ConnectionDTO {
    id: string;
    provider: string;
    name: string;
    isEnabled: boolean;
    configJson: Record<string, unknown>;
    lastTestedAt: string | null;
    lastTestStatus: string | null;
    createdAt: string;
    updatedAt: string;
    secretStatus: string;
    webhookUrl: string;
    _count?: { executions: number };
}

interface ProviderInfo {
    id: string;
    displayName: string;
    description: string;
    supportedChecks: string[];
    configSchema: {
        configFields: { key: string; label: string; type: string; required: boolean; placeholder?: string; description?: string }[];
        secretFields: { key: string; label: string; type: string; required: boolean; placeholder?: string; description?: string }[];
    };
}

export default function AdminIntegrationsPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();

    const [connections, setConnections] = useState<ConnectionDTO[]>([]);
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [webhookBaseUrl, setWebhookBaseUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formProvider, setFormProvider] = useState('');
    const [formName, setFormName] = useState('');
    const [formConfig, setFormConfig] = useState<Record<string, string>>({});
    const [formSecrets, setFormSecrets] = useState<Record<string, string>>({});
    const [showSecrets, setShowSecrets] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fetchConnections = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl('/admin/integrations'));
            const data = await res.json();
            setConnections(data.connections ?? []);
            setProviders(data.availableProviders ?? []);
            setWebhookBaseUrl(data.webhookBaseUrl ?? '');
        } catch {
            setMessage({ type: 'error', text: 'Failed to load integrations' });
        }
        setLoading(false);
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchConnections(); }, [fetchConnections]);

    const resetForm = () => {
        setShowForm(false);
        setEditingId(null);
        setFormProvider('');
        setFormName('');
        setFormConfig({});
        setFormSecrets({});
        setShowSecrets(false);
    };

    const handleSave = async () => {
        if (!formProvider || !formName) {
            setMessage({ type: 'error', text: 'Provider and name are required' });
            return;
        }
        setSaving(true);
        setMessage(null);
        try {
            const body: Record<string, unknown> = {
                provider: formProvider,
                name: formName,
                configJson: formConfig,
            };
            if (editingId) body.id = editingId;

            // Only send secrets if any field has a value
            const hasSecrets = Object.values(formSecrets).some(v => v.trim().length > 0);
            if (hasSecrets) {
                body.secrets = formSecrets;
            }

            const res = await fetch(apiUrl('/admin/integrations'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json();
                setMessage({ type: 'error', text: err.error || 'Failed to save' });
            } else {
                const data = await res.json();
                setMessage({
                    type: 'success',
                    text: editingId
                        ? 'Connection updated'
                        : `Connection created.${data.warning ? ` ${data.warning}` : ''}`,
                });
                resetForm();
                await fetchConnections();
            }
        } catch {
            setMessage({ type: 'error', text: 'Network error' });
        }
        setSaving(false);
    };

    const handleTest = async (conn: ConnectionDTO) => {
        setTesting(conn.id);
        setMessage(null);
        try {
            const res = await fetch(apiUrl('/admin/integrations'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connectionId: conn.id,
                    provider: conn.provider,
                    configJson: conn.configJson,
                }),
            });
            const data = await res.json();
            setMessage({
                type: data.valid ? 'success' : 'error',
                text: data.valid ? 'Connection test passed' : `Test failed: ${data.error || 'unknown error'}`,
            });
            await fetchConnections();
        } catch {
            setMessage({ type: 'error', text: 'Test failed: network error' });
        }
        setTesting(null);
    };

    const handleDisable = async (connectionId: string) => {
        setMessage(null);
        try {
            await fetch(apiUrl('/admin/integrations'), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connectionId }),
            });
            setMessage({ type: 'success', text: 'Connection disabled' });
            await fetchConnections();
        } catch {
            setMessage({ type: 'error', text: 'Failed to disable' });
        }
    };

    const selectedProvider = providers.find(p => p.id === formProvider);

    return (
            <div className="space-y-6 animate-fadeIn">
                <div className="flex items-center gap-3">
                    <Link href={tenantHref('/admin')} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                        <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </Link>
                    <h1 className="text-2xl font-bold">Integrations</h1>
                </div>

                {/* Message banner */}
                {message && (
                    <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                        message.type === 'success'
                            ? 'bg-bg-success border border-border-success text-content-success'
                            : 'bg-bg-error border border-border-error text-content-error'
                    }`}>
                        {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        {message.text}
                    </div>
                )}

                {/* Webhook endpoint info */}
                {webhookBaseUrl && (
                    <div className="glass-card p-4">
                        <p className="text-xs text-content-muted mb-1">Webhook Base URL</p>
                        <code className="text-sm text-[var(--brand-default)] font-mono">{webhookBaseUrl}/&#123;provider&#125;</code>
                    </div>
                )}

                {/* Connections list */}
                <div className="glass-card overflow-hidden">
                    <div className="flex justify-between items-center p-4 border-b border-border-default">
                        <h2 className="text-lg font-semibold">Configured Connections</h2>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => { resetForm(); setShowForm(true); }}
                            id="add-integration-btn"
                        >
                            <Plus className="w-3.5 h-3.5" /> Add Integration
                        </Button>
                    </div>

                    {loading ? (
                        <div className="p-8 text-center text-content-subtle">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                            <span className="sr-only">Fetching integrations</span>
                        </div>
                    ) : connections.length === 0 ? (
                        <div className="p-8 text-center text-content-subtle">
                            No integrations configured. Click &quot;Add Integration&quot; to get started.
                        </div>
                    ) : (
                        (() => {
                            const connCols = createColumns<ConnectionDTO>([
                                { accessorKey: 'provider', header: 'Provider', cell: ({ getValue }: any) => <span className="badge badge-info">{getValue()}</span> },
                                { accessorKey: 'name', header: 'Name', cell: ({ getValue }: any) => <span className="font-medium">{getValue()}</span> },
                                {
                                    id: 'status', header: 'Status', accessorKey: 'isEnabled',
                                    cell: ({ row }: any) => <span className={`badge ${row.original.isEnabled ? 'badge-success' : 'badge-error'}`}>{row.original.isEnabled ? 'Active' : 'Disabled'}</span>,
                                },
                                { id: 'secrets', header: 'Secrets', cell: () => <span className="text-content-subtle font-mono text-xs">••••••••</span> },
                                {
                                    id: 'lastTest', header: 'Last Test', accessorKey: 'lastTestedAt',
                                    cell: ({ row }: any) => row.original.lastTestedAt ? (
                                        <span className="flex items-center gap-1 text-xs text-content-muted">
                                            {row.original.lastTestStatus === 'ok' ? <CheckCircle className="w-3 h-3 text-content-success" /> : <XCircle className="w-3 h-3 text-content-error" />}
                                            {formatDate(row.original.lastTestedAt)}
                                        </span>
                                    ) : <span className="text-content-subtle text-xs">—</span>,
                                },
                                { id: 'executions', header: 'Executions', accessorFn: (c: ConnectionDTO) => c._count?.executions ?? 0, cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span> },
                                {
                                    id: 'actions', header: 'Actions',
                                    cell: ({ row }: any) => (
                                        <div className="flex gap-1">
                                            <Tooltip content="Test connection">
                                                <Button variant="secondary" size="xs" onClick={() => handleTest(row.original)} disabled={testing === row.original.id} aria-label="Test connection">
                                                    {testing === row.original.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                                                </Button>
                                            </Tooltip>
                                            <Tooltip content="Disable integration">
                                                <Button variant="danger-outline" size="xs" onClick={() => handleDisable(row.original.id)} aria-label="Disable integration">
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </Tooltip>
                                        </div>
                                    ),
                                },
                            ]);
                            return (
                                <DataTable
                                    data={connections}
                                    columns={connCols}
                                    getRowId={(c) => c.id}
                                    emptyState='No integrations configured. Click "Add Integration" to get started.'
                                    resourceName={(p) => p ? 'connections' : 'connection'}
                                    data-testid="integrations-table"
                                />
                            );
                        })()
                    )}
                </div>

                {/* Add/Edit Form */}
                {showForm && (
                    <div className="glass-card p-6 space-y-4">
                        <h3 className="text-lg font-semibold">
                            {editingId ? 'Edit Integration' : 'Add Integration'}
                        </h3>

                        {/* Provider select */}
                        <div>
                            <label className="block text-sm text-content-muted mb-1">Provider</label>
                            <Combobox
                                id="integration-provider-select"
                                selected={providers.map(p => ({ value: p.id, label: p.displayName })).find(o => o.value === formProvider) ?? null}
                                setSelected={(opt) => { setFormProvider(opt?.value ?? ''); setFormConfig({}); setFormSecrets({}); }}
                                options={providers.map(p => ({ value: p.id, label: p.displayName }))}
                                placeholder="Select a provider..."
                                disabled={!!editingId}
                                matchTriggerWidth
                            />
                            {selectedProvider && (
                                <p className="text-xs text-content-subtle mt-1">{selectedProvider.description}</p>
                            )}
                        </div>

                        {/* Name */}
                        <div>
                            <label className="block text-sm text-content-muted mb-1">Connection Name</label>
                            <input
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                className="input w-full"
                                placeholder="e.g. Acme GitHub Org"
                                id="integration-name-input"
                            />
                        </div>

                        {/* Config fields */}
                        {selectedProvider && selectedProvider.configSchema.configFields.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-sm font-medium text-content-default">Configuration</h4>
                                {selectedProvider.configSchema.configFields.map(field => (
                                    <div key={field.key}>
                                        <label className="block text-xs text-content-muted mb-1">
                                            {field.label} {field.required && <span className="text-content-error">*</span>}
                                        </label>
                                        <input
                                            type="text"
                                            value={formConfig[field.key] ?? ''}
                                            onChange={e => setFormConfig(prev => ({ ...prev, [field.key]: e.target.value }))}
                                            className="input w-full"
                                            placeholder={field.placeholder}
                                        />
                                        {field.description && (
                                            <p className="text-xs text-content-subtle mt-0.5">{field.description}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Secret fields */}
                        {selectedProvider && selectedProvider.configSchema.secretFields.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium text-content-default">Secrets</h4>
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        onClick={() => setShowSecrets(!showSecrets)}
                                    >
                                        {showSecrets ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                        {showSecrets ? 'Hide' : 'Show'}
                                    </Button>
                                </div>
                                <div className="p-3 rounded border border-border-warning bg-bg-warning">
                                    <p className="text-xs text-content-warning">
                                        Secrets are encrypted at rest. They cannot be viewed after saving.
                                    </p>
                                </div>
                                {selectedProvider.configSchema.secretFields.map(field => (
                                    <div key={field.key}>
                                        <label className="block text-xs text-content-muted mb-1">
                                            {field.label} {field.required && <span className="text-content-error">*</span>}
                                        </label>
                                        <input
                                            type={showSecrets ? 'text' : 'password'}
                                            value={formSecrets[field.key] ?? ''}
                                            onChange={e => setFormSecrets(prev => ({ ...prev, [field.key]: e.target.value }))}
                                            className="input w-full font-mono"
                                            placeholder={field.placeholder ?? '••••••••'}
                                            autoComplete="off"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Supported checks */}
                        {selectedProvider && (
                            <div>
                                <h4 className="text-sm font-medium text-content-default mb-1">Supported Checks</h4>
                                <div className="flex flex-wrap gap-1">
                                    {selectedProvider.supportedChecks.map(check => (
                                        <span key={check} className="badge badge-neutral text-xs">
                                            {selectedProvider.id}.{check}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                            <Button
                                variant="primary"
                                onClick={handleSave}
                                disabled={saving || !formProvider || !formName}
                                loading={saving}
                                id="save-integration-btn"
                            >
                                {editingId ? 'Update' : 'Create'} Connection
                            </Button>
                            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
                        </div>
                    </div>
                )}
            </div>
    );
}
