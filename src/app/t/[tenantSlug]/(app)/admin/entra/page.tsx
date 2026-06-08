'use client';

/* TODO(swr-migration): fetch-on-mount + setState pattern (matches the
 * sibling admin/sso page). Migrate to useTenantSWR with that page. */

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

interface EntraConfig {
    aadTenantId: string;
    clientId: string;
    groupClaimMode: 'securityGroup' | 'applicationRole';
    enforceGroupGate: boolean;
    allowedDomains?: string[];
}

const EMPTY: EntraConfig = {
    aadTenantId: '',
    clientId: '',
    groupClaimMode: 'securityGroup',
    enforceGroupGate: false,
    allowedDomains: [],
};

export default function EntraProviderWizard() {
    const apiUrl = useTenantApiUrl();
    const [config, setConfig] = useState<EntraConfig>(EMPTY);
    const [configured, setConfigured] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(apiUrl('/sso/entra'));
            if (!res.ok) return;
            const data = await res.json();
            if (data?.config) {
                setConfig({ ...EMPTY, ...data.config });
                setConfigured(true);
            }
        } catch {
            /* read-only load; ignore */
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void load(); }, [load]);

    const save = useCallback(async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const res = await fetch(apiUrl('/sso/entra'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...config,
                    allowedDomains: (config.allowedDomains ?? []).filter(Boolean),
                }),
            });
            if (!res.ok) {
                setError('Save failed — check the directory + client IDs are valid GUIDs.');
                return;
            }
            setConfigured(true);
            setSaved(true);
        } catch {
            setError('Save failed — network error.');
        } finally {
            setSaving(false);
        }
    }, [apiUrl, config]);

    return (
        <div className="space-y-section">
            <PageBreadcrumbs items={[{ label: 'Admin' }, { label: 'Entra ID' }]} />
            <div className="flex items-center gap-default">
                <Heading level={1}>Microsoft Entra ID</Heading>
                {configured && (
                    <span className="inline-flex items-center gap-tight text-sm text-content-muted">
                        Configured
                    </span>
                )}
            </div>

            {/* Step 1 + 2 — setup instructions the tenant admin performs in Entra */}
            <Card className="space-y-default p-6">
                <Heading level={3}>1 · App registration &amp; token configuration</Heading>
                <ol className="list-decimal space-y-tight pl-5 text-sm text-content-muted">
                    <li>
                        Create an App Registration in the Entra portal; set the redirect URI to{' '}
                        <code>{`{IC_URL}`}/api/auth/callback/microsoft-entra-id</code>.
                    </li>
                    <li>
                        In <strong>Token configuration</strong>, add a <strong>groups</strong> claim set to
                        <strong> Security groups</strong> (manifest{' '}
                        <code>&quot;groupMembershipClaims&quot;: &quot;SecurityGroup&quot;</code>). IC cannot
                        set this for you — without it, no group claims reach IC.
                    </li>
                </ol>
                <a
                    className="inline-flex items-center gap-tight text-sm text-content-link"
                    href="https://entra.microsoft.com"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open Entra portal ↗
                </a>
            </Card>

            {/* Step 3 — provider config form */}
            <Card className="space-y-default p-6">
                <Heading level={3}>2 · Provider configuration</Heading>
                {error && <InlineNotice variant="error">{error}</InlineNotice>}
                {saved && <InlineNotice variant="success">Saved.</InlineNotice>}

                <FormField label="Directory (tenant) ID">
                    <Input
                        id="aadTenantId"
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={config.aadTenantId}
                        onChange={(e) => setConfig((c) => ({ ...c, aadTenantId: e.target.value }))}
                    />
                </FormField>
                <FormField label="Application (client) ID">
                    <Input
                        id="clientId"
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={config.clientId}
                        onChange={(e) => setConfig((c) => ({ ...c, clientId: e.target.value }))}
                    />
                </FormField>
                <FormField label="Allowed sign-in domains (comma-separated, optional)">
                    <Input
                        id="domains"
                        placeholder="contoso.com, fabrikam.com"
                        value={(config.allowedDomains ?? []).join(', ')}
                        onChange={(e) =>
                            setConfig((c) => ({
                                ...c,
                                allowedDomains: e.target.value.split(',').map((s) => s.trim()),
                            }))
                        }
                    />
                </FormField>
                <FormField label="Group claim mode">
                    <ToggleGroup
                        selected={config.groupClaimMode}
                        selectAction={(v) =>
                            setConfig((c) => ({ ...c, groupClaimMode: v as EntraConfig['groupClaimMode'] }))
                        }
                        options={[
                            { value: 'securityGroup', label: 'Security groups' },
                            { value: 'applicationRole', label: 'Application roles' },
                        ]}
                    />
                </FormField>
                <FormField
                    label="Enforce group gate"
                    hint="When on, a user must belong to at least one mapped group to gain access."
                >
                    <ToggleGroup
                        selected={config.enforceGroupGate ? 'on' : 'off'}
                        selectAction={(v) => setConfig((c) => ({ ...c, enforceGroupGate: v === 'on' }))}
                        options={[
                            { value: 'off', label: 'Off' },
                            { value: 'on', label: 'On' },
                        ]}
                    />
                </FormField>

                <div className="flex justify-end pt-default">
                    <Button variant="primary" onClick={save} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
