'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { RequirePermission } from '@/components/require-permission';
import { ProgressBar } from '@/components/ui/progress-bar';
import { FrameworkExplorer } from '@/components/frameworks/FrameworkExplorer';
import { FrameworkBuilder } from '@/components/ui/FrameworkBuilder';
import { buttonVariants } from '@/components/ui/button-variants';
import { useCelebration } from '@/components/ui/hooks';
import { MILESTONES, scopedMilestone } from '@/lib/celebrations';
import type { FrameworkTreePayload } from '@/lib/framework-tree/types';

type Tab = 'requirements' | 'packs' | 'coverage' | 'builder';

export default function FrameworkDetailPage() {
    const params = useParams();
    const tenantSlug = params.tenantSlug as string;
    const frameworkKey = params.frameworkKey as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);
    const tenantHref = useCallback((path: string) => `/t/${tenantSlug}${path}`, [tenantSlug]);

    const [activeTab, setActiveTab] = useState<Tab>('requirements');
    const [framework, setFramework] = useState<any>(null);
    const [tree, setTree] = useState<FrameworkTreePayload | null>(null);
    const [packs, setPacks] = useState<any[]>([]);
    const [coverage, setCoverage] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Epic 62 — celebrate when this framework hits 100% coverage.
    // `scopedMilestone` namespaces the dedupe key per framework so
    // each framework's first reach earns its own moment in the same
    // session (otherwise a single global `framework-100` key would
    // mean only the first framework ever celebrates).
    const { celebrate } = useCelebration();
    useEffect(() => {
        if (coverage?.coveragePercent !== 100) return;
        const baseDescription = MILESTONES['framework-100'].description ?? '';
        celebrate(
            scopedMilestone('framework-100', frameworkKey, {
                descriptionOverride: framework?.name
                    ? `${framework.name} — ${baseDescription}`.trim()
                    : undefined,
            }),
        );
    }, [coverage?.coveragePercent, frameworkKey, framework?.name, celebrate]);

    useEffect(() => {
        // Epic 46 — fetch the new `/tree` endpoint instead of the
        // flat `?action=requirements` payload. The tree endpoint
        // already includes the `framework` descriptor, so the
        // separate `getFramework` call only stays around to keep the
        // header rendering identical (it carries no data the tree
        // doesn't, but `<FrameworkExplorer>` shouldn't be the source
        // of truth for the page title).
        (async () => {
            setError(null);
            try {
                const [fwRes, treeRes, packRes, covRes] = await Promise.all([
                    fetch(apiUrl(`/frameworks/${frameworkKey}`)),
                    fetch(apiUrl(`/frameworks/${frameworkKey}/tree`)),
                    fetch(apiUrl(`/frameworks/${frameworkKey}?action=packs`)),
                    fetch(apiUrl(`/frameworks/${frameworkKey}?action=coverage`)),
                ]);
                if (fwRes.ok) setFramework(await fwRes.json());
                if (treeRes.ok) setTree((await treeRes.json()) as FrameworkTreePayload);
                else if (treeRes.status === 404) setError('Framework not found');
                if (packRes.ok) setPacks(await packRes.json());
                if (covRes.ok) setCoverage(await covRes.json());
            } catch {
                setError('Failed to load framework');
            }
            setLoading(false);
        })();
    }, [apiUrl, frameworkKey]);

    if (loading) return <div className="p-8 animate-pulse text-content-muted" id="framework-detail-loading">Loading framework...</div>;
    if (error || !framework) return <div className="p-8 text-content-error" id="framework-detail-error">{error ?? 'Framework not found'}</div>;

    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'requirements', label: 'Requirements', count: tree?.totals.requirements },
        { key: 'packs', label: 'Packs', count: packs.length },
        { key: 'coverage', label: 'Coverage' },
        // Epic 46.4 — builder MVP. Permission-gated below by
        // wrapping the panel in <RequirePermission>; the tab itself
        // stays visible so non-admins see it exists.
        { key: 'builder', label: 'Builder' },
    ];

    async function handleReorderSave(body: { sections: { sectionId: string; requirementIds: string[] }[] }) {
        const res = await fetch(apiUrl(`/frameworks/${frameworkKey}/reorder`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? `Reorder failed (${res.status})`);
        }
        // Refetch the tree so the explorer reflects the new order.
        const fresh = await fetch(apiUrl(`/frameworks/${frameworkKey}/tree`));
        if (fresh.ok) setTree((await fresh.json()) as FrameworkTreePayload);
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-3">
                        <Link href={tenantHref('/frameworks')} className="text-content-muted hover:text-content-emphasis transition-colors">← Frameworks</Link>
                    </div>
                    <h1 className="text-2xl font-bold text-content-emphasis mt-2" id="framework-detail-heading">{framework.name}</h1>
                    <div className="flex items-center gap-2 mt-1">
                        {framework.version && <span className="badge badge-primary text-xs">v{framework.version}</span>}
                        {framework.kind && <span className="text-xs text-content-subtle">{framework.kind.replace('_', ' ')}</span>}
                    </div>
                    {framework.description && <p className="text-sm text-content-muted mt-2">{framework.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link href={tenantHref(`/frameworks/${frameworkKey}/templates`)} className={buttonVariants({ variant: 'secondary' })} id="browse-templates-cta">
                        Browse Templates
                    </Link>
                    <RequirePermission resource="frameworks" action="install">
                        <Link href={tenantHref(`/frameworks/${frameworkKey}/install`)} className={buttonVariants({ variant: 'primary' })} id="install-pack-cta">
                            Install Pack
                        </Link>
                    </RequirePermission>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-bg-default/50 p-1 rounded-lg w-full sm:w-fit overflow-x-auto" id="framework-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-brand-600 text-content-emphasis' : 'text-content-muted hover:text-content-emphasis'
                            }`}
                        id={`tab-${tab.key}`}
                    >
                        {tab.label}
                        {tab.count !== undefined && <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>}
                    </button>
                ))}
            </div>

            {/* Requirements Tab — Epic 46 tree explorer */}
            {activeTab === 'requirements' && (
                <div id="requirements-panel">
                    {tree ? (
                        <FrameworkExplorer tree={tree} coverage={coverage ?? null} />
                    ) : (
                        <div className="glass-card text-center py-10 text-content-subtle">
                            Loading tree...
                        </div>
                    )}
                </div>
            )}

            {/* Packs Tab */}
            {activeTab === 'packs' && (
                <div className="space-y-4" id="packs-panel">
                    {packs.map((p: any) => (
                        <div key={p.id} className="glass-card">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-content-emphasis">{p.name}</h3>
                                    {p.description && <p className="text-sm text-content-muted mt-1">{p.description}</p>}
                                    <div className="flex items-center gap-3 mt-2 text-xs text-content-subtle">
                                        <span>{p._count?.templateLinks || 0} templates</span>
                                        {p.version && <span>v{p.version}</span>}
                                    </div>
                                </div>
                                <RequirePermission resource="frameworks" action="install">
                                    <Link
                                        href={tenantHref(`/frameworks/${frameworkKey}/install?pack=${p.key}`)}
                                        className={buttonVariants({ variant: 'primary' })}
                                        id={`install-pack-${p.key}`}
                                    >
                                        Install Pack
                                    </Link>
                                </RequirePermission>
                            </div>
                        </div>
                    ))}
                    {packs.length === 0 && (
                        <div className="glass-card text-center py-8 text-content-subtle">No packs available for this framework.</div>
                    )}
                </div>
            )}

            {/* Coverage Tab */}
            {activeTab === 'coverage' && coverage && (
                <div className="space-y-4" id="coverage-panel">
                    {/* Summary cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="glass-card text-center">
                            <div className="text-3xl font-bold text-content-emphasis">{coverage.total}</div>
                            <div className="text-xs text-content-muted mt-1">Total Requirements</div>
                        </div>
                        <div className="glass-card text-center">
                            <div className="text-3xl font-bold text-content-success">{coverage.mapped}</div>
                            <div className="text-xs text-content-muted mt-1">Mapped</div>
                        </div>
                        <div className="glass-card text-center">
                            <div className={`text-3xl font-bold ${coverage.unmapped > 0 ? 'text-content-warning' : 'text-content-success'}`}>{coverage.unmapped}</div>
                            <div className="text-xs text-content-muted mt-1">Unmapped</div>
                        </div>
                    </div>

                    {/* Coverage donut */}
                    <div className="glass-card">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-content-emphasis">Overall Coverage</h3>
                            <span className={`text-2xl font-bold ${coverage.coveragePercent === 100 ? 'text-content-success' : 'text-[var(--brand-default)]'}`}>
                                {coverage.coveragePercent}%
                            </span>
                        </div>
                        <ProgressBar
                            value={coverage.coveragePercent}
                            size="lg"
                            variant={coverage.coveragePercent === 100 ? 'success' : 'brand'}
                            aria-label="Framework coverage"
                        />
                    </div>

                    {/* Section breakdown */}
                    {coverage.bySection?.length > 0 && (
                        <div className="glass-card">
                            <h3 className="text-sm font-semibold text-content-emphasis mb-3">Coverage by Section</h3>
                            <div className="space-y-3">
                                {coverage.bySection.map((s: any) => (
                                    <div key={s.section}>
                                        <div className="flex items-center justify-between text-xs mb-1">
                                            <span className="text-content-default">{s.section}</span>
                                            <span className="text-content-muted">{s.mapped}/{s.total} ({s.coveragePercent}%)</span>
                                        </div>
                                        <ProgressBar
                                            value={s.coveragePercent}
                                            size="sm"
                                            variant={
                                                s.coveragePercent === 100
                                                    ? 'success'
                                                    : s.coveragePercent > 0
                                                        ? 'brand'
                                                        : 'neutral'
                                            }
                                            aria-label={`${s.section} coverage`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Unmapped requirements */}
                    {coverage.unmappedRequirements?.length > 0 && (
                        <div className="glass-card">
                            <h3 className="text-sm font-semibold text-content-warning mb-3">
                                Unmapped Requirements ({coverage.unmappedRequirements.length})
                            </h3>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                                {coverage.unmappedRequirements.map((r: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-bg-elevated/20 text-sm">
                                        <span className="w-2 h-2 rounded-full bg-border-emphasis flex-shrink-0" />
                                        <code className="text-xs text-content-subtle font-mono w-16 sm:w-28 flex-shrink-0 truncate">{r.code}</code>
                                        <span className="text-content-muted">{r.title}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            )}

            {/* Builder Tab — Epic 46.4 MVP */}
            {activeTab === 'builder' && (
                <div id="builder-panel">
                    {tree ? (
                        <RequirePermission
                            resource="frameworks"
                            action="install"
                            fallback={
                                <div className="glass-card text-center py-10 text-content-subtle">
                                    Reordering is restricted to OWNER / ADMIN roles.
                                </div>
                            }
                        >
                            <FrameworkBuilder tree={tree} onSave={handleReorderSave} />
                        </RequirePermission>
                    ) : (
                        <div className="glass-card text-center py-10 text-content-subtle">
                            Loading tree...
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
