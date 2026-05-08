'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function DiffPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const tenantSlug = params.tenantSlug as string;
    const frameworkKey = params.frameworkKey as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);
    const tenantHref = useCallback((path: string) => `/t/${tenantSlug}${path}`, [tenantSlug]);

    const fromKey = searchParams.get('from') || '';
    const [diff, setDiff] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [framework, setFramework] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<'added' | 'removed' | 'changed'>('added');

    useEffect(() => {
        (async () => {
            try {
                const fwRes = await fetch(apiUrl(`/frameworks/${frameworkKey}`));
                if (fwRes.ok) setFramework(await fwRes.json());

                if (fromKey) {
                    const diffRes = await fetch(apiUrl(`/frameworks/${frameworkKey}?action=diff&from=${fromKey}`));
                    if (diffRes.ok) {
                        setDiff(await diffRes.json());
                    } else {
                        setError('Failed to compute diff. Ensure both frameworks exist.');
                    }
                }
            } catch { setError('Failed to load data'); }
            setLoading(false);
        })();
    }, [apiUrl, frameworkKey, fromKey]);

    if (loading) return <div className="p-8 animate-pulse text-content-muted">Loading diff...</div>;

    return (
        <div className="space-y-6">
            <div>
                <Link href={tenantHref(`/frameworks/${frameworkKey}`)} className="text-content-muted hover:text-content-emphasis transition-colors text-sm">
                    ← Back to {framework?.name || frameworkKey}
                </Link>
                <h1 className="text-2xl font-bold text-content-emphasis mt-2" id="diff-heading">
                    Requirements Diff
                </h1>
                {diff && (
                    <p className="text-sm text-content-muted mt-1">
                        Comparing <span className="text-[var(--brand-default)]">{diff.from.name} v{diff.from.version}</span>
                        {' → '}
                        <span className="text-[var(--brand-default)]">{diff.to.name} v{diff.to.version}</span>
                    </p>
                )}
            </div>

            {!fromKey && (
                <div className="glass-card text-center py-8 text-content-muted">
                    <p>Specify a <code className="text-[var(--brand-default)]">?from=FRAMEWORK_KEY</code> query parameter to compare.</p>
                    <p className="text-xs mt-2 text-content-subtle">This page compares the &quot;from&quot; framework to this framework to show added/removed/changed requirements.</p>
                </div>
            )}

            {error && <div className="glass-card text-content-error">{error}</div>}

            {diff && (
                <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4" id="diff-summary">
                        <div className="glass-card text-center">
                            <div className="text-3xl font-bold text-content-success">{diff.summary.added}</div>
                            <div className="text-xs text-content-muted mt-1">Added</div>
                        </div>
                        <div className="glass-card text-center">
                            <div className="text-3xl font-bold text-content-error">{diff.summary.removed}</div>
                            <div className="text-xs text-content-muted mt-1">Removed</div>
                        </div>
                        <div className="glass-card text-center">
                            <div className="text-3xl font-bold text-content-warning">{diff.summary.changed}</div>
                            <div className="text-xs text-content-muted mt-1">Changed</div>
                        </div>
                        <div className="glass-card text-center">
                            <div className={`text-3xl font-bold ${diff.summary.unmappedNewRequirements > 0 ? 'text-content-error' : 'text-content-success'}`}>
                                {diff.summary.unmappedNewRequirements}
                            </div>
                            <div className="text-xs text-content-muted mt-1">New Unmapped</div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 bg-bg-default/50 p-1 rounded-lg w-fit" id="diff-tabs">
                        {(['added', 'removed', 'changed'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab ? 'bg-brand-600 text-content-emphasis' : 'text-content-muted hover:text-content-emphasis'
                                    }`}
                                id={`diff-tab-${tab}`}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)} ({diff[tab].length})
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="space-y-2" id="diff-content">
                        {activeTab === 'added' && diff.added.map((r: any, i: number) => (
                            <div key={i} className="glass-card flex items-center gap-3">
                                <span className="text-content-success text-lg font-bold">+</span>
                                <code className="text-xs text-[var(--brand-default)] font-mono w-28 flex-shrink-0">{r.code}</code>
                                <span className="text-sm text-content-default">{r.title}</span>
                                {r.section && <span className="text-xs text-content-subtle ml-auto">{r.section}</span>}
                            </div>
                        ))}

                        {activeTab === 'removed' && diff.removed.map((r: any, i: number) => (
                            <div key={i} className="glass-card flex items-center gap-3">
                                <span className="text-content-error text-lg font-bold">−</span>
                                <code className="text-xs text-content-error/60 font-mono w-28 flex-shrink-0 line-through">{r.code}</code>
                                <span className="text-sm text-content-subtle line-through">{r.title}</span>
                                {r.section && <span className="text-xs text-content-subtle ml-auto">{r.section}</span>}
                            </div>
                        ))}

                        {activeTab === 'changed' && diff.changed.map((r: any, i: number) => (
                            <div key={i} className="glass-card">
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-content-warning text-lg font-bold">~</span>
                                    <code className="text-xs text-[var(--brand-default)] font-mono">{r.code}</code>
                                    <span className="text-xs text-content-subtle">Changed: {r.changes.join(', ')}</span>
                                </div>
                                <div className="ml-8 space-y-1">
                                    {r.changes.includes('title') && (
                                        <div className="text-xs">
                                            <span className="text-content-error line-through">{r.from.title}</span>
                                            <span className="text-content-subtle mx-2">→</span>
                                            <span className="text-content-success">{r.to.title}</span>
                                        </div>
                                    )}
                                    {r.changes.includes('section') && (
                                        <div className="text-xs">
                                            <span className="text-content-subtle">Section: </span>
                                            <span className="text-content-error">{r.from.section || '(none)'}</span>
                                            <span className="text-content-subtle mx-2">→</span>
                                            <span className="text-content-success">{r.to.section || '(none)'}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {diff[activeTab].length === 0 && (
                            <div className="glass-card text-center py-6 text-content-subtle">
                                No {activeTab} requirements.
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
