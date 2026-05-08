'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import Link from 'next/link';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText, SearchX } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';

export default function TemplatesPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const tenant = useTenantContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
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

    const filtered = useMemo(() => {
        let result = templates;
        if (search) {
            const q = search.toLowerCase();
            result = result.filter(t =>
                t.title.toLowerCase().includes(q) ||
                (t.tags || '').toLowerCase().includes(q)
            );
        }
        if (categoryFilter) result = result.filter(t => t.category === categoryFilter);
        return result;
    }, [templates, search, categoryFilter]);

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
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <Heading level={1}>Policy Templates</Heading>
                    <p className="text-content-muted text-sm">{templates.length} templates available</p>
                </div>
                <Link href={tenantHref('/policies')} className={buttonVariants({ variant: 'secondary' })}>← Back to Policies</Link>
            </div>

            {/* Filters */}
            <div className="glass-card p-4 flex flex-wrap gap-3 items-center">
                <input
                    type="text" className="input flex-1 min-w-[200px]" placeholder="Search templates..."
                    value={search} onChange={e => setSearch(e.target.value)} id="template-search"
                />
                <Combobox
                    hideSearch
                    id="template-category-filter"
                    selected={categories.map(c => ({ value: c, label: c })).find(o => o.value === categoryFilter) ?? null}
                    setSelected={(opt) => setCategoryFilter(opt?.value ?? '')}
                    options={categories.map(c => ({ value: c, label: c }))}
                    placeholder="All Categories"
                    matchTriggerWidth
                    buttonProps={{ className: 'w-48' }}
                />
            </div>

            {/* Grid */}
            {loading ? (
                <div className="p-12 text-center text-content-subtle animate-pulse">Loading templates...</div>
            ) : filtered.length === 0 ? (
                <div className="glass-card">
                    {templates.length === 0 ? (
                        <EmptyState
                            icon={FileText}
                            variant="no-records"
                            title="No templates available yet"
                            description="Policy templates will appear here once your tenant or admin loads them."
                        />
                    ) : (
                        <EmptyState
                            icon={SearchX}
                            variant="no-results"
                            title="No templates match your filters"
                            description="Try clearing the category filter or broadening your search."
                        />
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" id="template-grid">
                    {filtered.map(tpl => (
                        <Card className="flex flex-col justify-between hover:ring-1 hover:ring-[var(--brand-default)]/30 transition" key={tpl.id}>
                            <div>
                                <Heading level={3} className="mb-1">{tpl.title}</Heading>
                                <div className="flex gap-2 mb-2">
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
                                    {creating === tpl.id ? 'Creating...' : 'Use Template'}
                                </Button>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
