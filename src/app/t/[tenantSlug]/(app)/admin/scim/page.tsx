'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';

import { useState, useEffect, useCallback } from 'react';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { CloudCog, Plus, Trash2, Copy, Check, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/components/ui/hooks';
import { CopyButton } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface ScimToken {
    id: string;
    label: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}

interface ScimState {
    tokens: ScimToken[];
    scimEndpoint: string;
    isEnabled: boolean;
}

export default function ScimAdminPage() {
    const apiUrl = useTenantApiUrl();
    const [state, setState] = useState<ScimState | null>(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [newTokenPlaintext, setNewTokenPlaintext] = useState<string | null>(null);
    const [newLabel, setNewLabel] = useState('');
    const [showForm, setShowForm] = useState(false);
    const { copy, copied } = useCopyToClipboard({ timeout: 2500 });
    const [error, setError] = useState<string | null>(null);
    const [tokenIdToRevoke, setTokenIdToRevoke] = useState<string | null>(null);

    const fetchTokens = useCallback(async () => {
        try {
            const res = await fetch(apiUrl('/admin/scim'));
            if (res.ok) {
                setState(await res.json());
            } else if (res.status === 401 || res.status === 403) {
                setError('You do not have permission to view SCIM tokens.');
            } else {
                setError(`Failed to load SCIM state (${res.status}).`);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load SCIM state.');
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchTokens(); }, [fetchTokens]);

    const generateToken = async () => {
        setGenerating(true);
        setError(null);
        try {
            const res = await fetch(apiUrl('/admin/scim'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: newLabel || 'SCIM Token' }),
            });
            if (!res.ok) throw new Error('Failed to generate token');
            const data = await res.json();
            setNewTokenPlaintext(data.plaintext);
            setShowForm(false);
            setNewLabel('');
            fetchTokens();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
        } finally {
            setGenerating(false);
        }
    };

    const revokeToken = (tokenId: string) => setTokenIdToRevoke(tokenId);

    const performRevoke = async (tokenId: string) => {
        try {
            await fetch(apiUrl('/admin/scim'), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenId }),
            });
            fetchTokens();
        } catch { /* ignore */ }
    };

    const copyToken = async () => {
        if (!newTokenPlaintext) return;
        const ok = await copy(newTokenPlaintext);
        if (ok) {
            toast.success('SCIM token copied — paste it into your IdP now.');
        } else {
            toast.error('Copy failed — select the token and copy manually.');
        }
    };

    const activeTokens = state?.tokens.filter(t => !t.revokedAt) || [];
    const revokedTokens = state?.tokens.filter(t => t.revokedAt) || [];

    return (
        <div className="space-y-6 animate-fadeIn max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <CloudCog className="w-6 h-6 text-[var(--brand-default)]" />
                        SCIM Provisioning
                    </h1>
                    <p className="text-sm text-content-muted mt-1">
                        Automate user provisioning from your identity provider (Okta, Azure AD, OneLogin).
                    </p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                    activeTokens.length > 0
                        ? 'bg-bg-success text-content-success border border-border-success'
                        : 'bg-bg-elevated/50 text-content-muted border border-border-emphasis'
                }`}>
                    {activeTokens.length > 0 ? 'Enabled' : 'Not Configured'}
                </div>
            </div>

            {/* Endpoint Info — render the slot eagerly so #scim-endpoint-url
                is queryable before the GET /admin/scim fetch resolves. */}
            <div className="glass-card p-4">
                <h3 className="text-sm font-medium text-content-default mb-2">SCIM Endpoint</h3>
                <div className="flex items-center gap-2 bg-bg-default/50 rounded px-3 py-2">
                    <code
                        className="text-xs text-[var(--brand-muted)] flex-1 select-all min-h-[1.25rem] inline-block"
                        id="scim-endpoint-url"
                    >
                        {state?.scimEndpoint ?? (loading ? 'Loading endpoint…' : '—')}
                    </code>
                    <CopyButton
                        value={state?.scimEndpoint ?? ''}
                        label="Copy SCIM endpoint"
                        successMessage="SCIM endpoint copied"
                        size="sm"
                        disabled={!state?.scimEndpoint}
                    />
                    <ExternalLink className="w-3.5 h-3.5 text-content-subtle" />
                </div>
                <p className="text-xs text-content-subtle mt-1">
                    Use this base URL when configuring SCIM in your identity provider.
                </p>
            </div>

            {/* New Token Alert - Only shown once */}
            {newTokenPlaintext && (
                <div className="glass-card p-4 border-2 border-border-warning bg-bg-warning" id="new-token-alert">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-content-warning shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-bold text-content-warning">Copy your SCIM token now</h3>
                            <p className="text-xs text-content-warning/80 mt-1">
                                This token will not be shown again. Store it securely in your identity provider.
                            </p>
                            <div className="flex items-center gap-2 mt-3 bg-bg-page/60 rounded px-3 py-2">
                                <code className="text-xs text-content-emphasis flex-1 break-all select-all" id="scim-token-value">
                                    {newTokenPlaintext}
                                </code>
                                <Button variant="secondary" size="sm" onClick={copyToken} className="shrink-0" id="copy-token-btn">
                                    {copied ? <Check className="w-3.5 h-3.5 text-content-success" /> : <Copy className="w-3.5 h-3.5" />}
                                    {copied ? 'Copied' : 'Copy'}
                                </Button>
                            </div>
                        </div>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setNewTokenPlaintext(null)}
                        className="mt-3 w-full"
                    >
                        I&apos;ve copied the token — dismiss
                    </Button>
                </div>
            )}

            {/* Token List */}
            <div className="glass-card">
                <div className="flex items-center justify-between p-4 border-b border-border-default/50">
                    <h2 className="text-sm font-semibold">SCIM Tokens</h2>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setShowForm(true)}
                        id="generate-token-btn"
                        disabled={generating}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Generate Token
                    </Button>
                </div>

                {/* Generate form */}
                {showForm && (
                    <div className="p-4 border-b border-border-default/50 bg-bg-default/30">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newLabel}
                                onChange={e => setNewLabel(e.target.value)}
                                placeholder="Token label (e.g. Okta SCIM)"
                                className="input flex-1"
                                id="token-label-input"
                                autoFocus
                            />
                            <Button variant="primary" size="sm" onClick={generateToken} disabled={generating} loading={generating}>
                                {generating ? 'Generating…' : 'Create'}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="p-3 text-xs text-content-error bg-bg-error border-b border-border-error">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="p-8 text-center text-content-subtle text-sm"><span className="animate-pulse">Fetching tokens</span></div>
                ) : activeTokens.length === 0 && !showForm ? (
                    <div className="p-8 text-center">
                        <CloudCog className="w-8 h-8 text-content-subtle mx-auto mb-2" />
                        <p className="text-sm text-content-muted">No active SCIM tokens</p>
                        <p className="text-xs text-content-subtle mt-1">
                            Generate a token to enable automated provisioning from your identity provider.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-border-default/50">
                        {activeTokens.map(token => (
                            <div key={token.id} className="flex items-center justify-between p-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-content-emphasis">{token.label}</span>
                                        <span className="badge badge-success text-[10px]">Active</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1">
                                        <span className="text-xs text-content-subtle">
                                            Created {formatDate(token.createdAt)}
                                        </span>
                                        {token.lastUsedAt && (
                                            <span className="text-xs text-content-muted flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                Last used {formatDate(token.lastUsedAt)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <Button
                                    variant="danger-outline"
                                    size="sm"
                                    onClick={() => revokeToken(token.id)}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Revoke
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Revoked tokens */}
            {revokedTokens.length > 0 && (
                <details className="glass-card">
                    <summary className="p-4 cursor-pointer text-sm text-content-muted hover:text-content-default">
                        {revokedTokens.length} revoked token{revokedTokens.length !== 1 ? 's' : ''}
                    </summary>
                    <div className="divide-y divide-border-default/50 border-t border-border-default/50">
                        {revokedTokens.map(token => (
                            <div key={token.id} className="flex items-center justify-between p-4 opacity-50">
                                <div>
                                    <span className="text-sm text-content-muted">{token.label}</span>
                                    <span className="badge badge-error text-[10px] ml-2">Revoked</span>
                                    <div className="text-xs text-content-subtle mt-1">
                                        Revoked {formatDate(token.revokedAt!)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Setup guide */}
            <div className="glass-card p-5">
                <h3 className="text-sm font-semibold mb-3">Setup Guide</h3>
                <ol className="space-y-2 text-xs text-content-muted list-decimal list-inside">
                    <li>Generate a SCIM token above and copy it securely.</li>
                    <li>In your IdP (Okta, Azure AD, etc.), configure a SCIM 2.0 provisioning connector.</li>
                    <li>Set the <strong>SCIM connector base URL</strong> to the endpoint shown above.</li>
                    <li>Set <strong>Authentication</strong> to &quot;HTTP Header&quot; with the bearer token.</li>
                    <li>Enable provisioning actions: <em>Create Users</em>, <em>Update User Attributes</em>, <em>Deactivate Users</em>.</li>
                    <li>Test the connection from your IdP&apos;s SCIM provisioning settings.</li>
                </ol>
                <div className="mt-4 p-3 bg-bg-default/50 rounded text-xs text-content-subtle">
                    <strong className="text-content-muted">Role mapping:</strong> SCIM-provisioned users are assigned the <strong>Reader</strong> role by default.
                    Editors and Auditors can be mapped via your IdP&apos;s group/role assignment.
                    Admin role cannot be assigned via SCIM — it must be set manually.
                </div>
            </div>
            <ConfirmDialog
                showModal={tokenIdToRevoke !== null}
                setShowModal={(open) => {
                    if (typeof open === 'function') {
                        const next = open(tokenIdToRevoke !== null);
                        if (!next) setTokenIdToRevoke(null);
                    } else if (!open) {
                        setTokenIdToRevoke(null);
                    }
                }}
                tone="danger"
                title="Revoke SCIM token?"
                description="Any IdP using this token will lose access immediately. This cannot be undone."
                confirmLabel="Revoke token"
                onConfirm={async () => {
                    if (tokenIdToRevoke) await performRevoke(tokenIdToRevoke);
                }}
            />
        </div>
    );
}
