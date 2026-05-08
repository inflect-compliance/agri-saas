'use client';

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { useState, useEffect, useCallback } from 'react';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { Shield, CheckCircle, XCircle, AlertTriangle, ExternalLink, Trash2, Save, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { InfoTooltip } from '@/components/ui/tooltip';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface SsoProvider {
    id: string;
    type: 'SAML' | 'OIDC';
    name: string;
    isEnabled: boolean;
    isEnforced: boolean;
    emailDomains: string[];
    configJson: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

type Tab = 'OIDC' | 'SAML';

// Hoisted to module scope to satisfy react-hooks/static-components.
// Was previously declared inside `SsoAdminPage` and closed over
// `existingProvider`; now takes it as a prop.
function StatusBadge({ existingProvider }: { existingProvider: SsoProvider | null | undefined }) {
    if (!existingProvider) {
        return <span className="badge badge-neutral text-xs">Not Configured</span>;
    }
    if (existingProvider.isEnforced) {
        return <span className="badge badge-warning text-xs">Enforced</span>;
    }
    if (existingProvider.isEnabled) {
        return <span className="badge badge-info text-xs">Enabled</span>;
    }
    return <span className="badge badge-danger text-xs">Disabled</span>;
}

export default function SsoAdminPage() {
    const apiUrl = useTenantApiUrl();
    const [providers, setProviders] = useState<SsoProvider[]>([]);
    const [tab, setTab] = useState<Tab>('OIDC');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // ── Form state ──
    const [formName, setFormName] = useState('');
    const [formEmailDomains, setFormEmailDomains] = useState('');
    const [formEnabled, setFormEnabled] = useState(false);
    const [formEnforced, setFormEnforced] = useState(false);
    const [showSecret, setShowSecret] = useState(false);

    // OIDC fields
    const [oidcIssuer, setOidcIssuer] = useState('');
    const [oidcClientId, setOidcClientId] = useState('');
    const [oidcClientSecret, setOidcClientSecret] = useState('');
    const [oidcScopes, setOidcScopes] = useState('openid email profile');

    // SAML fields
    const [samlEntityId, setSamlEntityId] = useState('');
    const [samlSsoUrl, setSamlSsoUrl] = useState('');
    const [samlCertificate, setSamlCertificate] = useState('');
    const [samlNameIdFormat, setSamlNameIdFormat] = useState('');

    const fetchProviders = useCallback(async () => {
        try {
            const res = await fetch(apiUrl('/sso'));
            if (res.ok) {
                const data = await res.json();
                setProviders(data);
            }
        } catch {
            // Silently fail on fetch errors
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchProviders(); }, [fetchProviders]);

    // ── Load existing provider into form ──
    const existingProvider = providers.find((p) => p.type === tab);

    useEffect(() => {
        if (existingProvider) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setFormName(existingProvider.name);
            setFormEmailDomains(existingProvider.emailDomains.join(', '));
            setFormEnabled(existingProvider.isEnabled);
            setFormEnforced(existingProvider.isEnforced);
            const config = existingProvider.configJson;
            if (existingProvider.type === 'OIDC') {
                setOidcIssuer((config.issuer as string) || '');
                setOidcClientId((config.clientId as string) || '');
                setOidcClientSecret((config.clientSecret as string) || '');
                setOidcScopes(Array.isArray(config.scopes)
                    ? (config.scopes as string[]).join(' ')
                    : 'openid email profile');
            } else {
                setSamlEntityId((config.entityId as string) || '');
                setSamlSsoUrl((config.ssoUrl as string) || '');
                setSamlCertificate((config.certificate as string) || '');
                setSamlNameIdFormat((config.nameIdFormat as string) || '');
            }
        } else {
            resetForm();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, existingProvider?.id]);

    function resetForm() {
        setFormName('');
        setFormEmailDomains('');
        setFormEnabled(false);
        setFormEnforced(false);
        setOidcIssuer('');
        setOidcClientId('');
        setOidcClientSecret('');
        setOidcScopes('openid email profile');
        setSamlEntityId('');
        setSamlSsoUrl('');
        setSamlCertificate('');
        setSamlNameIdFormat('');
    }

    // ── Save handler ──
    async function handleSave() {
        setError(null);
        setSuccess(null);
        setSaving(true);

        const emailDomains = formEmailDomains
            .split(/[,\s]+/)
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);

        const config = tab === 'OIDC'
            ? {
                issuer: oidcIssuer,
                clientId: oidcClientId,
                // Don't send masked value back
                ...(oidcClientSecret !== '••••••••' && { clientSecret: oidcClientSecret }),
                ...(existingProvider && oidcClientSecret === '••••••••' && {
                    clientSecret: (existingProvider.configJson as Record<string, string>).clientSecret,
                }),
                scopes: oidcScopes.split(/\s+/).filter(Boolean),
            }
            : {
                entityId: samlEntityId,
                ssoUrl: samlSsoUrl,
                ...(samlCertificate !== '••••••••' && { certificate: samlCertificate }),
                ...(existingProvider && samlCertificate === '••••••••' && {
                    certificate: (existingProvider.configJson as Record<string, string>).certificate,
                }),
                ...(samlNameIdFormat && { nameIdFormat: samlNameIdFormat }),
            };

        try {
            const res = await fetch(apiUrl('/sso'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: existingProvider?.id,
                    name: formName || `${tab} Provider`,
                    type: tab,
                    isEnabled: formEnabled,
                    isEnforced: formEnforced,
                    emailDomains,
                    config,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                setError(err.error || err.message || 'Save failed');
                return;
            }

            setSuccess('Configuration saved successfully');
            await fetchProviders();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    // ── Toggle handlers ──
    async function handleToggle(action: string) {
        if (!existingProvider) return;
        setError(null);
        try {
            const res = await fetch(apiUrl('/sso'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: existingProvider.id, action }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                setError(err.error || 'Toggle failed');
                return;
            }
            await fetchProviders();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    // ── Delete handler ──
    function handleDelete() {
        if (!existingProvider) return;
        setShowDeleteConfirm(true);
    }

    async function performDelete() {
        if (!existingProvider) return;
        setError(null);
        try {
            const res = await fetch(apiUrl('/sso'), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: existingProvider.id }),
            });
            if (res.ok) {
                resetForm();
                await fetchProviders();
                setSuccess('Configuration deleted');
            }
        } catch (err) {
            setError((err as Error).message);
        }
    }

    // StatusBadge hoisted to module scope (above) — see comment there.

    function testLoginUrl() {
        if (!existingProvider) return null;
        const tenantSlug = window.location.pathname.split('/')[2];
        const protocol = tab.toLowerCase();
        return `/api/auth/sso/${protocol}/start?tenant=${tenantSlug}&provider=${existingProvider.id}&returnTo=${window.location.pathname}`;
    }

    if (loading) {
        return (
            <div className="space-y-6 animate-fadeIn">
                <h1 className="text-2xl font-bold">SSO &amp; Identity</h1>
                <div className="glass-card p-8 space-y-4">
                    <div className="h-4 bg-bg-elevated/50 rounded w-1/3 animate-pulse" />
                    <div className="h-4 bg-bg-elevated/50 rounded w-2/3 animate-pulse" />
                    <div className="h-4 bg-bg-elevated/50 rounded w-1/2 animate-pulse" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Shield className="w-6 h-6 text-[var(--brand-default)]" />
                    SSO &amp; Identity
                </h1>
                <p className="text-sm text-content-muted mt-1">
                    Configure enterprise single sign-on for your workspace.
                </p>
            </div>

            {/* Protocol tabs — Epic 60 ToggleGroup. `id` on each option
                preserves `#sso-tab-oidc` / `#sso-tab-saml` DOM anchors
                for any future E2E selector use. */}
            <div className="flex items-center gap-2">
                <ToggleGroup
                    ariaLabel="SSO protocol"
                    options={[
                        { value: 'OIDC', label: 'OIDC', id: 'sso-tab-oidc' },
                        { value: 'SAML', label: 'SAML 2.0', id: 'sso-tab-saml' },
                    ]}
                    selected={tab}
                    selectAction={(v) => setTab(v as 'OIDC' | 'SAML')}
                />
                <div className="ml-auto">
                    <StatusBadge existingProvider={existingProvider} />
                </div>
            </div>

            {/* Messages */}
            {error && (
                <div className="p-3 bg-bg-error border border-border-error rounded-lg flex items-center gap-2" id="sso-error">
                    <XCircle className="w-4 h-4 text-content-error" />
                    <span className="text-sm text-content-error">{error}</span>
                </div>
            )}
            {success && (
                <div className="p-3 bg-bg-success border border-border-success rounded-lg flex items-center gap-2" id="sso-success">
                    <CheckCircle className="w-4 h-4 text-content-success" />
                    <span className="text-sm text-content-success">{success}</span>
                </div>
            )}

            {/* Config form */}
            <div className="glass-card p-6">
                <h2 className="text-lg font-semibold mb-4">{tab} Configuration</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Provider name */}
                    <div>
                        <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                            Provider Name
                        </label>
                        <input
                            id="sso-name"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder={tab === 'OIDC' ? 'e.g. Okta, Azure AD' : 'e.g. Okta SAML, ADFS'}
                            className="input w-full"
                        />
                    </div>

                    {/* Email domains */}
                    <div>
                        <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                            Email Domains
                        </label>
                        <input
                            id="sso-domains"
                            value={formEmailDomains}
                            onChange={(e) => setFormEmailDomains(e.target.value)}
                            placeholder="acme.com, acme.io"
                            className="input w-full"
                        />
                        <span className="text-xs text-content-subtle mt-0.5">Comma-separated</span>
                    </div>
                </div>

                {/* Protocol-specific fields */}
                {tab === 'OIDC' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">Issuer URL</label>
                            <input
                                id="sso-oidc-issuer"
                                value={oidcIssuer}
                                onChange={(e) => setOidcIssuer(e.target.value)}
                                placeholder="https://login.example.com"
                                className="input w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">Client ID</label>
                            <input
                                id="sso-oidc-client-id"
                                value={oidcClientId}
                                onChange={(e) => setOidcClientId(e.target.value)}
                                placeholder="client-id-from-idp"
                                className="input w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">Client Secret</label>
                            <div className="relative">
                                <input
                                    id="sso-oidc-client-secret"
                                    type={showSecret ? 'text' : 'password'}
                                    value={oidcClientSecret}
                                    onChange={(e) => setOidcClientSecret(e.target.value)}
                                    placeholder="client-secret"
                                    className="input w-full pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowSecret(!showSecret)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-emphasis"
                                >
                                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">Scopes</label>
                            <input
                                id="sso-oidc-scopes"
                                value={oidcScopes}
                                onChange={(e) => setOidcScopes(e.target.value)}
                                placeholder="openid email profile"
                                className="input w-full"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">IdP Entity ID</label>
                            <input
                                id="sso-saml-entity-id"
                                value={samlEntityId}
                                onChange={(e) => setSamlEntityId(e.target.value)}
                                placeholder="https://idp.example.com"
                                className="input w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">SSO URL</label>
                            <input
                                id="sso-saml-sso-url"
                                value={samlSsoUrl}
                                onChange={(e) => setSamlSsoUrl(e.target.value)}
                                placeholder="https://idp.example.com/saml/sso"
                                className="input w-full"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">X.509 Certificate</label>
                            <textarea
                                id="sso-saml-certificate"
                                value={samlCertificate}
                                onChange={(e) => setSamlCertificate(e.target.value)}
                                placeholder="MIICzjCCAb..."
                                rows={3}
                                className="input w-full font-mono text-xs"
                            />
                        </div>
                        <div>
                            <div className="mb-1 flex items-center gap-1.5">
                                <label className="text-xs text-content-muted uppercase tracking-wider">NameID Format (optional)</label>
                                <InfoTooltip
                                    aria-label="About NameID format"
                                    iconClassName="h-3.5 w-3.5"
                                    content="Leave empty if your IdP issues email-format NameIDs (the common case). Override only if your IdP uses a non-standard URN — check the IdP's SAML attribute mapping."
                                />
                            </div>
                            <input
                                id="sso-saml-nameid"
                                value={samlNameIdFormat}
                                onChange={(e) => setSamlNameIdFormat(e.target.value)}
                                placeholder="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
                                className="input w-full text-xs"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">ACS URL (your callback)</label>
                            <input
                                readOnly
                                value={typeof window !== 'undefined'
                                    ? `${window.location.origin}/api/auth/sso/saml/callback`
                                    : '/api/auth/sso/saml/callback'}
                                className="input w-full text-xs text-content-subtle cursor-not-allowed"
                            />
                        </div>
                    </div>
                )}

                {/* Toggles */}
                <div className="flex items-center gap-6 mt-6 pt-4 border-t border-border-default/50">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formEnabled}
                            onChange={(e) => setFormEnabled(e.target.checked)}
                            className="accent-[var(--brand-default)]"
                            id="sso-enabled"
                        />
                        <span className="text-sm text-content-emphasis">Enable SSO</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formEnforced}
                            onChange={(e) => setFormEnforced(e.target.checked)}
                            className="accent-amber-500"
                            id="sso-enforced"
                        />
                        <span className="text-sm text-content-emphasis">Enforce SSO</span>
                        <span className="text-xs text-content-subtle">(disables local login)</span>
                        <InfoTooltip
                            aria-label="About SSO enforcement"
                            iconClassName="h-3.5 w-3.5"
                            content="Everyone must sign in via your IdP once this saves. Local-password admins keep break-glass access — confirm at least one admin has a working password before enabling."
                        />
                    </label>
                </div>

                {formEnforced && (
                    <div className="mt-3 p-3 bg-bg-warning border border-border-warning rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-content-warning mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-content-warning">
                            When enforced, users must authenticate via SSO. Only admins with a local password can bypass (break-glass access).
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-6">
                    <Button
                        variant="primary"
                        onClick={handleSave}
                        disabled={saving}
                        loading={saving}
                        id="sso-save-btn"
                    >
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving...' : 'Save Configuration'}
                    </Button>

                    {existingProvider && existingProvider.isEnabled && (
                        <a
                            href={testLoginUrl() || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonVariants({ variant: 'secondary' })}
                            id="sso-test-btn"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Test Login
                        </a>
                    )}

                    {existingProvider && (
                        <Button
                            variant="danger-outline"
                            onClick={handleDelete}
                            className="ml-auto"
                            id="sso-delete-btn"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                        </Button>
                    )}
                </div>
            </div>

            {/* Info card */}
            <div className="glass-card p-4 border border-border-default/50">
                <h3 className="text-sm font-semibold text-content-emphasis mb-2">How SSO works</h3>
                <ul className="text-xs text-content-muted space-y-1.5">
                    <li>• Users must already have an account and tenant membership to login via SSO</li>
                    <li>• SSO links are created automatically on first successful login</li>
                    <li>• When enforced, only admins with a local password can bypass SSO (break-glass)</li>
                    <li>• Email domains help auto-discover SSO on the login page</li>
                </ul>
            </div>
            <ConfirmDialog
                showModal={showDeleteConfirm}
                setShowModal={setShowDeleteConfirm}
                tone="danger"
                title="Delete SSO configuration?"
                description="Users will need to use local login until SSO is reconfigured. This cannot be undone."
                confirmLabel="Delete configuration"
                onConfirm={performDelete}
            />
        </div>
    );
}
