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
import { useTranslations } from 'next-intl';
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
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cardVariants } from '@/components/ui/card';

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
    const t = useTranslations('admin.vendorTemplates');
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
            setCreateError(t('keyNameRequired'));
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
                setCreateError(body.error ?? t('httpStatus', { status: res.status }));
                return;
            }
            const created = (await res.json()) as { id: string };
            router.push(tenantHref(`/admin/vendor-templates/${created.id}`));
        } finally {
            setCreating(false);
        }
    }

    return (
        <div className="space-y-section animate-fadeIn">
            <header>
                <PageBreadcrumbs
                    items={[
                        { label: t('breadcrumbDashboard'), href: tenantHref('/dashboard') },
                        { label: t('breadcrumbAdmin'), href: tenantHref('/admin') },
                        { label: t('breadcrumbVendorTemplates') },
                    ]}
                    className="mb-1"
                />
                <Heading level={1} id="vendor-templates-title">
                    {t('heading')}
                </Heading>
                <p className="text-sm text-content-muted mt-1">
                    {t('description')}
                </p>
            </header>

            {permissions.canWrite && (
                <div className={cardVariants({ density: 'compact' })}>
                    <Heading level={3} className="mb-3">
                        {t('createNewTemplate')}
                    </Heading>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-compact items-end">
                        <div>
                            <label
                                className="text-xs text-content-muted block mb-1"
                                htmlFor="new-template-key"
                            >
                                {t('keyLabel')}
                            </label>
                            <input
                                id="new-template-key"
                                className="input w-full"
                                value={newKey}
                                onChange={(e) => setNewKey(e.target.value)}
                                placeholder={'soc2-vendor'}
                            />
                        </div>
                        <div>
                            <label
                                className="text-xs text-content-muted block mb-1"
                                htmlFor="new-template-name"
                            >
                                {t('nameLabel')}
                            </label>
                            <input
                                id="new-template-name"
                                className="input w-full"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder={t('namePlaceholder')}
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
                                {creating ? t('creating') : t('createDraft')}
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

            <div className={cardVariants({ density: 'compact' })}>
                <Heading level={3} className="mb-3">
                    {t('allTemplates', { count: items?.length ?? 0 })}
                </Heading>
                {loading ? (
                    <SkeletonCard lines={3} />
                ) : items === null || items.length === 0 ? (
                    <EmptyState
                        variant="no-records"
                        title={t('noTemplates')}
                        description={t('noTemplatesDesc')}
                    />
                ) : (
                    <div className="divide-y divide-border-default/40">
                        {items.map((item) => (
                            <Link
                                key={item.id}
                                href={tenantHref(
                                    `/admin/vendor-templates/${item.id}`,
                                )}
                                className="flex items-center justify-between py-3 hover:bg-bg-muted/50 px-2 rounded transition"
                                data-testid={`template-row-${item.id}`}
                            >
                                <div>
                                    <div className="text-sm text-content-emphasis font-medium">
                                        {item.name}
                                    </div>
                                    <div className="text-xs text-content-subtle">
                                        {item.key} · v{item.version} ·{' '}
                                        {t('sectionsCount', { count: item._count.sections })} ·{' '}
                                        {t('questionsCount', { count: item._count.questions })}
                                    </div>
                                </div>
                                <div className="flex items-center gap-compact">
                                    <StatusBadge variant={item.isPublished ? 'success' : 'warning'} size="sm">
                                        {item.isPublished ? t('published') : t('draft')}
                                    </StatusBadge>
                                    <span className="text-xs text-content-subtle">
                                        {t('updatedOn', { date: formatDate(item.updatedAt) })}
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
