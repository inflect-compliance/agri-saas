'use client';
import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import Link from 'next/link';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { FileContent, Magnifier } from '@/components/ui/icons/nucleo';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Card, cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

export default function TemplatesPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const tenant = useTenantContext();
    const t = useTranslations('policies.templates');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [creating, setCreating] = useState('');

    useEffect(() => {
        fetch(apiUrl('/policies/templates'))
            .then(r => r.json())
            .then(t => { setTemplates(t); setLoading(false); })
            .catch(() => setLoading(false));
    }, [apiUrl]);

    const categories = useMemo(() =>
        [...new Set(templates.map(t => t.category).filter(Boolean))].sort(),
        [templates]
    );

    // R14-PR7 — the standalone search input was dropped. Users
    // find templates by category combobox below or the global
    // command palette (⌘K). If granular search becomes load-bearing
    // here, adopt the FilterToolbar primitive — never reintroduce a
    // hand-rolled `<input type="search">` per CLAUDE.md filter
    // strategy.
    const filtered = useMemo(() => {
        if (!categoryFilter) return templates;
        return templates.filter(t => t.category === categoryFilter);
    }, [templates, categoryFilter]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleUseTemplate = async (tpl: any) => {
        if (!tenant.permissions.canWrite) return;
        setCreating(tpl.id);
        try {
            const res = await fetch(apiUrl('/policies'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: tpl.title, templateId: tpl.id, category: tpl.category }),
            });
            if (res.ok) {
                const policy = await res.json();
                router.push(tenantHref(`/policies/${policy.id}`));
            }
        } finally {
            setCreating('');
        }
    };

    return (
        <div className="space-y-section animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <Heading level={1}>{t('heading')}</Heading>
                    <p className="text-content-muted text-sm">{t('countAvailable', { count: templates.length })}</p>
                </div>
                <Link href={tenantHref('/policies')} className={buttonVariants({ variant: 'secondary' })}>{t('backToPolicies')}</Link>
            </div>

            {/* Filters */}
            <div className={cn(cardVariants({ density: 'compact' }), 'flex flex-wrap gap-compact items-center')}>
                <Combobox
                    hideSearch
                    id="template-category-filter"
                    selected={categories.map(c => ({ value: c, label: c })).find(o => o.value === categoryFilter) ?? null}
                    setSelected={(opt) => setCategoryFilter(opt?.value ?? '')}
                    options={categories.map(c => ({ value: c, label: c }))}
                    placeholder={t('allCategories')}
                    matchTriggerWidth
                    buttonProps={{ className: 'w-48' }}
                />
            </div>

            {/* Grid */}
            {loading ? (
                <div className="p-12 text-center text-content-subtle animate-pulse">{t('loading')}</div>
            ) : filtered.length === 0 ? (
                <div className={cardVariants({ density: 'none' })}>
                    {templates.length === 0 ? (
                        <EmptyState
                            icon={FileContent}
                            variant="no-records"
                            title={t('emptyRecords.title')}
                            description={t('emptyRecords.description')}
                        />
                    ) : (
                        <EmptyState
                            icon={Magnifier}
                            variant="no-results"
                            title={t('emptyResults.title')}
                            description={t('emptyResults.description')}
                        />
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-default" id="template-grid">
                    {filtered.map(tpl => (
                        <Card className="flex flex-col justify-between hover:ring-1 hover:ring-[var(--brand-default)]/30 transition" key={tpl.id}>
                            <div>
                                <Heading level={3} className="mb-1">{tpl.title}</Heading>
                                <div className="flex gap-tight mb-2">
                                    {tpl.category && <StatusBadge variant="neutral">{tpl.category}</StatusBadge>}
                                    {tpl.language && <span className="text-xs text-content-subtle">{tpl.language.toUpperCase()}</span>}
                                </div>
                                {tpl.tags && (
                                    <div className="flex flex-wrap gap-1 mb-3">
                                        {tpl.tags.split(',').map((tag: string) => (
                                            <span key={tag.trim()} className="text-xs px-1.5 py-0.5 rounded bg-bg-elevated/50 text-content-muted">
                                                {tag.trim()}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-content-subtle line-clamp-3">
                                    {tpl.contentText?.substring(0, 150)}...
                                </p>
                            </div>
                            {tenant.permissions.canWrite && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    className="mt-4 w-full"
                                    onClick={() => handleUseTemplate(tpl)}
                                    disabled={!!creating}
                                    id={`use-template-${tpl.id}`}
                                >
                                    {creating === tpl.id ? t('creating') : t('useTemplate')}
                                </Button>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
