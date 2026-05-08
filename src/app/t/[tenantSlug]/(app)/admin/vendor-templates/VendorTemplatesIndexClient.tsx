'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Epic G-3 — admin index for vendor questionnaire templates.
 *
 * Lists existing templates (latest version per key) with a quick-
 * create form. Click a row to open the builder.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    useTenantApiUrl,
    useTenantHref,
    useTenantContext,
} from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format-date';
import { SkeletonCard } from '@/components/ui/skeleton';

interface TemplateRow {
    id: string;
    key: string;
    version: number;
    name: string;
    description: string | null;
    isPublished: boolean;
    isGlobal: boolean;
    updatedAt: string;
    _count: { sections: number; questions: number };
}

export function VendorTemplatesIndexClient() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const { permissions } = useTenantContext();

    const [items, setItems] = useState<TemplateRow[] | null>(null);
    const [loading, setLoading] = useState(true);

    const [creating, setCreating] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [newName, setNewName] = useState('');
    const [createError, setCreateError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl('/vendor-assessment-templates'));
            if (res.ok) setItems(await res.json());
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refresh();
    }, [refresh]);

    async function handleCreate() {
        if (!newName.trim() || !newKey.trim()) {
            setCreateError('Key and name are required.');
            return;
        }
        setCreating(true);
        setCreateError(null);
        try {
            const res = await fetch(apiUrl('/vendor-assessment-templates'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: newKey, name: newName }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setCreateError(body.error ?? `HTTP ${res.status}`);
                return;
            }
            const created = (await res.json()) as { id: string };
            router.push(tenantHref(`/admin/vendor-templates/${created.id}`));
        } finally {
            setCreating(false);
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <header>
                <h1 className="text-2xl font-bold" id="vendor-templates-title">
                    Vendor questionnaire templates
                </h1>
                <p className="text-sm text-content-muted mt-1">
                    Author and publish reusable assessment templates. Edits
                    on a published template require cloning to a new draft
                    revision.
                </p>
            </header>

            {permissions.canWrite && (
                <div className="glass-card p-4">
                    <h2 className="text-sm font-semibold mb-3">
                        Create a new template
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                        <div>
                            <label
                                className="text-xs text-content-muted block mb-1"
                                htmlFor="new-template-key"
                            >
                                Key
                            </label>
                            <input
                                id="new-template-key"
                                className="input w-full"
                                value={newKey}
                                onChange={(e) => setNewKey(e.target.value)}
                                placeholder="soc2-vendor"
                            />
                        </div>
                        <div>
                            <label
                                className="text-xs text-content-muted block mb-1"
                                htmlFor="new-template-name"
                            >
                                Name
                            </label>
                            <input
                                id="new-template-name"
                                className="input w-full"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="SOC 2 vendor questionnaire"
                            />
                        </div>
                        <div>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleCreate}
                                disabled={creating}
                                loading={creating}
                                id="create-template-btn"
                            >
                                {creating ? 'Creating…' : 'Create draft'}
                            </Button>
                        </div>
                    </div>
                    {createError && (
                        <p
                            className="text-xs text-content-error mt-2"
                            role="alert"
                            data-testid="create-template-error"
                        >
                            {createError}
                        </p>
                    )}
                </div>
            )}

            <div className="glass-card p-4">
                <h2 className="text-sm font-semibold mb-3">
                    All templates ({items?.length ?? 0})
                </h2>
                {loading ? (
                    <SkeletonCard lines={3} />
                ) : items === null || items.length === 0 ? (
                    <p className="text-sm text-content-subtle">
                        No templates yet. Use the form above to create one.
                    </p>
                ) : (
                    <div className="divide-y divide-border-default/40">
                        {items.map((t) => (
                            <Link
                                key={t.id}
                                href={tenantHref(
                                    `/admin/vendor-templates/${t.id}`,
                                )}
                                className="flex items-center justify-between py-3 hover:bg-bg-default/30 px-2 rounded transition"
                                data-testid={`template-row-${t.id}`}
                            >
                                <div>
                                    <div className="text-sm text-content-emphasis font-medium">
                                        {t.name}
                                    </div>
                                    <div className="text-xs text-content-subtle">
                                        {t.key} · v{t.version} ·{' '}
                                        {t._count.sections} section(s) ·{' '}
                                        {t._count.questions} question(s)
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span
                                        className={`badge badge-xs ${t.isPublished ? 'badge-success' : 'badge-warning'}`}
                                    >
                                        {t.isPublished ? 'Published' : 'Draft'}
                                    </span>
                                    <span className="text-xs text-content-subtle">
                                        Updated {formatDate(t.updatedAt)}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
