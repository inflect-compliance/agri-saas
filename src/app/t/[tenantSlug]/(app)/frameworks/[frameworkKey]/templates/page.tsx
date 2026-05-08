'use client';
/* eslint-disable react-hooks/exhaustive-deps -- Various useEffect/useMemo dep arrays in this file deliberately omit identity-unstable callbacks (handlers recreated each render) or use selector functions whose change-detection happens elsewhere. Adding the deps would either trigger unnecessary re-runs OR cause infinite render loops; the proper structural fix is to wrap parent-level callbacks in useCallback. Tracked as follow-up. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function TemplateLibraryPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const tenantSlug = params.tenantSlug as string;
    const frameworkKey = params.frameworkKey as string;
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);
    const tenantHref = useCallback((path: string) => `/t/${tenantSlug}${path}`, [tenantSlug]);

    const [templates, setTemplates] = useState<any[]>([]);
    const [framework, setFramework] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [category, setCategory] = useState('');
    const [section, setSection] = useState('');
    const [installing, setInstalling] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkInstalling, setBulkInstalling] = useState(false);
    const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

    const fetchTemplates = useCallback(async () => {
        const params = new URLSearchParams({ action: 'templates' });
        if (search) params.set('search', search);
        if (category) params.set('category', category);
        if (section) params.set('section', section);
        try {
            const res = await fetch(apiUrl(`/frameworks/${frameworkKey}?${params}`));
            if (res.ok) setTemplates(await res.json());
        } catch { /* ignore */ }
    }, [apiUrl, frameworkKey, search, category, section]);

    useEffect(() => {
        (async () => {
            const [fwRes] = await Promise.all([
                fetch(apiUrl(`/frameworks/${frameworkKey}`)),
            ]);
            if (fwRes.ok) setFramework(await fwRes.json());
            await fetchTemplates();
            setLoading(false);
        })();
    }, [apiUrl, frameworkKey, fetchTemplates]);

    // Debounced search
    useEffect(() => {
        const id = setTimeout(fetchTemplates, 300);
        return () => clearTimeout(id);
    }, [search, category, section, fetchTemplates]);

    const installTemplate = async (code: string) => {
        setInstalling(code);
        try {
            await fetch(apiUrl(`/frameworks/${frameworkKey}?action=install-template`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateCode: code }),
            });
            await fetchTemplates();
        } catch { /* ignore */ }
        setInstalling(null);
    };

    const bulkInstall = async () => {
        if (selected.size === 0) return;
        setBulkInstalling(true);
        try {
            await fetch(apiUrl(`/frameworks/${frameworkKey}?action=bulk-install`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateCodes: Array.from(selected) }),
            });
            setSelected(new Set());
            await fetchTemplates();
        } catch { /* ignore */ }
        setBulkInstalling(false);
    };

    const toggleSelect = (code: string) => {
        const next = new Set(selected);
        next.has(code) ? next.delete(code) : next.add(code);
        setSelected(next);
    };

    const selectAll = () => {
        const uninstalled = templates.filter(t => !t.installed).map(t => t.code);
        setSelected(new Set(uninstalled));
    };

    const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];
    const sections = [...new Set(templates.flatMap(t => t.requirements.map((r: any) => r.section)).filter(Boolean))];
    const installed = templates.filter(t => t.installed).length;
    const available = templates.filter(t => !t.installed).length;

    const categoryOptions = useMemo<ComboboxOption[]>(
        () => [
            { value: '', label: 'All Categories' },
            ...categories.map((c) => ({ value: c as string, label: c as string })),
        ],
        [categories],
    );
    const sectionOptions = useMemo<ComboboxOption[]>(
        () => [
            { value: '', label: 'All Sections' },
            ...sections.map((s) => ({ value: s as string, label: s as string })),
        ],
        [sections],
    );

    if (loading) return <div className="p-8 animate-pulse text-content-muted">Loading template library...</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <Link href={tenantHref(`/frameworks/${frameworkKey}`)} className="text-content-muted hover:text-content-emphasis transition-colors text-sm">
                        ← Back to {framework?.name || frameworkKey}
                    </Link>
                    <h1 className="text-2xl font-bold text-content-emphasis mt-2" id="template-library-heading">
                        Template Library — {framework?.name}
                    </h1>
                    <div className="flex gap-3 mt-1 text-xs text-content-subtle">
                        <span>{templates.length} templates</span>
                        <span className="text-content-success">{installed} installed</span>
                        <span className="text-[var(--brand-default)]">{available} available</span>
                    </div>
                </div>
                {selected.size > 0 && (
                    <Button
                        variant="primary"
                        onClick={bulkInstall}
                        disabled={bulkInstalling}
                        id="bulk-install-btn"
                    >
                        {bulkInstalling ? 'Installing...' : `Install ${selected.size} Selected`}
                    </Button>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center" id="template-filters">
                <input
                    type="text"
                    placeholder="Search templates..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="input w-60"
                    id="template-search"
                />
                <Combobox
                    id="filter-category"
                    options={categoryOptions}
                    selected={categoryOptions.find(o => o.value === category) ?? categoryOptions[0]}
                    setSelected={(opt) => setCategory(opt?.value ?? '')}
                    placeholder="All Categories"
                    searchPlaceholder="Search categories…"
                    matchTriggerWidth
                    buttonProps={{ className: 'w-40' }}
                    caret
                />
                <Combobox
                    id="filter-section"
                    options={sectionOptions}
                    selected={sectionOptions.find(o => o.value === section) ?? sectionOptions[0]}
                    setSelected={(opt) => setSection(opt?.value ?? '')}
                    placeholder="All Sections"
                    searchPlaceholder="Search sections…"
                    matchTriggerWidth
                    buttonProps={{ className: 'w-48' }}
                    caret
                />
                <Button variant="secondary" size="xs" onClick={selectAll} id="select-all-btn">Select All Uninstalled</Button>
            </div>

            {/* Template cards */}
            <div className="space-y-3" id="template-list">
                {templates.map(t => {
                    const isExpanded = expandedTemplate === t.code;
                    const isSelected = selected.has(t.code);

                    return (
                        <div key={t.code} className={`glass-card transition-colors ${isSelected ? 'ring-1 ring-[var(--ring)]/50' : ''}`} id={`template-${t.code}`}>
                            <div className="flex items-start gap-3">
                                {/* Checkbox */}
                                {!t.installed && (
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleSelect(t.code)}
                                        className="mt-1 accent-[var(--brand-default)]"
                                    />
                                )}

                                {/* Main */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setExpandedTemplate(isExpanded ? null : t.code)}
                                            className="text-left flex-1 min-w-0"
                                        >
                                            <div className="flex items-center gap-2">
                                                <code className="text-xs text-[var(--brand-default)] font-mono">{t.code}</code>
                                                <span className="text-sm font-medium text-content-emphasis truncate">{t.title}</span>
                                                {t.installed ? (
                                                    <span className="badge badge-success text-xs flex-shrink-0">Installed</span>
                                                ) : (
                                                    <span className="badge badge-primary text-xs flex-shrink-0">Available</span>
                                                )}
                                            </div>
                                        </button>
                                        {!t.installed && (
                                            <Button
                                                variant="primary"
                                                size="xs"
                                                onClick={() => installTemplate(t.code)}
                                                disabled={installing === t.code}
                                                className="flex-shrink-0"
                                            >
                                                {installing === t.code ? '...' : 'Install'}
                                            </Button>
                                        )}
                                    </div>

                                    {/* Badges row */}
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {t.category && <span className="text-xs text-content-subtle bg-bg-default px-2 py-0.5 rounded">{t.category}</span>}
                                        {t.defaultFrequency && <span className="text-xs text-content-subtle bg-bg-default px-2 py-0.5 rounded">{t.defaultFrequency}</span>}
                                        <span className="text-xs text-content-subtle">{t.tasks.length} tasks</span>
                                        <span className="text-xs text-content-subtle">{t.requirements.length} requirements</span>
                                    </div>

                                    {/* Expanded detail */}
                                    {isExpanded && (
                                        <div className="mt-3 space-y-3 border-t border-border-default/30 pt-3">
                                            {t.description && (
                                                <p className="text-sm text-content-muted">{t.description}</p>
                                            )}

                                            {/* Requirements */}
                                            <div>
                                                <h4 className="text-xs font-semibold text-content-subtle mb-1">Mapped Requirements</h4>
                                                <div className="space-y-1">
                                                    {t.requirements.map((r: any, i: number) => (
                                                        <div key={i} className="flex items-center gap-2 text-xs">
                                                            <code className="text-[var(--brand-default)] font-mono">{r.code}</code>
                                                            <span className="text-content-muted">{r.title}</span>
                                                            <span className="text-content-subtle">({r.framework.name})</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Tasks */}
                                            <div>
                                                <h4 className="text-xs font-semibold text-content-subtle mb-1">Default Tasks</h4>
                                                <div className="space-y-1">
                                                    {t.tasks.map((task: any, i: number) => (
                                                        <div key={i} className="flex items-center gap-2 text-xs">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-border-emphasis" />
                                                            <span className="text-content-default">{task.title}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Suggested evidence */}
                                            <div>
                                                <h4 className="text-xs font-semibold text-content-subtle mb-1">Suggested Evidence Types</h4>
                                                <div className="flex flex-wrap gap-1">
                                                    {['DOCUMENT', 'SCREENSHOT', 'LOG'].map(type => (
                                                        <span key={type} className="text-xs bg-bg-default text-content-muted px-2 py-0.5 rounded">{type}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {templates.length === 0 && (
                    <div className="glass-card text-center py-8 text-content-subtle">No templates match your filters.</div>
                )}
            </div>
        </div>
    );
}
