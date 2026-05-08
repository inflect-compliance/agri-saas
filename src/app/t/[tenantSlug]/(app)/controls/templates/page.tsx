'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable @typescript-eslint/no-explicit-any -- Tanstack-react-table cell callbacks (tanstack cell callbacks where row/getValue carry the implicit-any annotation) — typing each callback with `CellContext<TData, TValue>` requires importing the right generic per column and adds significant ceremony. The implicit any here is at the render-time boundary; row.original is type-narrowed by the column's accessorKey at runtime. */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { AppIcon } from '@/components/icons/AppIcon';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { DataTable, createColumns } from '@/components/ui/table';

export default function ControlTemplatesPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const router = useRouter();
    const { permissions } = useTenantContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const fetchTemplates = useCallback(async () => {
        setLoading(true);
        const res = await fetch(apiUrl('/controls/templates'));
        if (res.ok) setTemplates(await res.json());
        setLoading(false);
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

    const toggle = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === filtered.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filtered.map(t => t.id)));
        }
    };

    const handleInstall = async () => {
        if (selectedIds.size === 0) return;
        setInstalling(true);
        setError('');
        try {
            const res = await fetch(apiUrl('/controls/templates/install'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateIds: Array.from(selectedIds) }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(typeof data.error === 'string' ? data.error : data.message || 'Failed to install templates');
            }
            const result = await res.json();
            const count = Array.isArray(result) ? result.length : 1;
            setSuccess(`Installed ${count} control(s) successfully!`);
            setTimeout(() => router.push(tenantHref('/controls')), 1500);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            setError(e.message);
        } finally {
            setInstalling(false);
        }
    };

    const filtered = templates.filter(t =>
        !searchQuery ||
        t.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.frameworkTag?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" id="templates-heading"><AppIcon name="templates" className="inline-block mr-2 align-text-bottom" /> Control Templates</h1>
                    <p className="text-content-muted text-sm">Select templates to install as controls in your register</p>
                </div>
                <Link href={tenantHref('/controls')} className={buttonVariants({ variant: 'secondary' })}>
                    ← Back to Controls
                </Link>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-bg-error border border-border-error text-content-error text-sm">{error}</div>
            )}
            {success && (
                <div className="p-3 rounded-lg bg-bg-success border border-border-success text-content-success text-sm" id="install-success">{success}</div>
            )}

            {/* Filters + Install bar */}
            <div className="glass-card p-4">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex gap-3 items-center flex-1">
                        <input
                            type="text"
                            className="input flex-1 min-w-[200px]"
                            placeholder="Search templates..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            id="template-search"
                        />
                    </div>
                    {permissions.canWrite && (
                        <Button
                            variant="primary"
                            onClick={handleInstall}
                            disabled={selectedIds.size === 0 || installing}
                            id="install-selected-btn"
                        >
                            {installing ? 'Installing...' : `Install Selected (${selectedIds.size})`}
                        </Button>
                    )}
                </div>
            </div>

            {/* Template list */}
            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-content-subtle animate-pulse">Loading templates...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center text-content-subtle">
                        <p className="text-lg mb-2">No templates found</p>
                        <p className="text-sm">Templates are seeded by your admin.</p>
                    </div>
                ) : (
                    (() => {
                        const templateCols = createColumns<any>([
                            {
                                id: 'select', header: () => (
                                    <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="rounded" />
                                ),
                                cell: ({ row }: any) => (
                                    <input type="checkbox" checked={selectedIds.has(row.original.id)} onChange={() => toggle(row.original.id)} className="rounded" />
                                ),
                            },
                            { accessorKey: 'code', header: 'Code', cell: ({ getValue }: any) => <span className="text-xs text-content-muted font-mono">{getValue() || '—'}</span> },
                            { accessorKey: 'name', header: 'Name', cell: ({ getValue }: any) => <span className="font-medium text-content-emphasis">{getValue()}</span> },
                            {
                                accessorKey: 'category', header: 'Category',
                                cell: ({ getValue }: any) => getValue() ? <span className="badge badge-info text-xs">{getValue()}</span> : null,
                            },
                            {
                                accessorKey: 'frameworkTag', header: 'Framework',
                                cell: ({ getValue }: any) => getValue() ? <span className="badge badge-neutral text-xs">{getValue()}</span> : null,
                            },
                            { accessorKey: 'description', header: 'Description', cell: ({ getValue }: any) => <span className="text-xs text-content-subtle truncate max-w-xs">{getValue() || '—'}</span> },
                        ]);
                        return (
                            <DataTable
                                data={filtered}
                                columns={templateCols}
                                getRowId={(t: any) => t.id}
                                onRowClick={(row) => toggle(row.original.id)}
                                emptyState={<div className="text-center"><p className="text-lg mb-2">No templates found</p><p className="text-sm">Templates are seeded by your admin.</p></div>}
                                resourceName={(p) => p ? 'templates' : 'template'}
                                data-testid="templates-table"
                            />
                        );
                    })()
                )}
            </div>
        </div>
    );
}
