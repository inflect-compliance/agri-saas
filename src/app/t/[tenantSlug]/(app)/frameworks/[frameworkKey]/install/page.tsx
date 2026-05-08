'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function InstallWizardPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const tenantSlug = params.tenantSlug as string;
    const frameworkKey = params.frameworkKey as string;
    const requestedPack = searchParams.get('pack');
    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);
    const tenantHref = useCallback((path: string) => `/t/${tenantSlug}${path}`, [tenantSlug]);

    const [framework, setFramework] = useState<any>(null);
    const [packs, setPacks] = useState<any[]>([]);
    const [selectedPack, setSelectedPack] = useState<string>('');
    const [preview, setPreview] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState('');

    // Step: 'select' | 'preview' | 'done'
    const [step, setStep] = useState<'select' | 'preview' | 'done'>('select');

    useEffect(() => {
        (async () => {
            try {
                const [fwRes, packRes] = await Promise.all([
                    fetch(apiUrl(`/frameworks/${frameworkKey}`)),
                    fetch(apiUrl(`/frameworks/${frameworkKey}?action=packs`)),
                ]);
                if (fwRes.ok) setFramework(await fwRes.json());
                if (packRes.ok) {
                    const ps = await packRes.json();
                    setPacks(ps);
                    // Auto-select if only one pack or requested
                    if (requestedPack) {
                        setSelectedPack(requestedPack);
                    } else if (ps.length === 1) {
                        setSelectedPack(ps[0].key);
                    }
                }
            } catch { /* ignore */ }
            setLoading(false);
        })();
    }, [apiUrl, frameworkKey, requestedPack]);

    // Fetch preview when pack selected
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!selectedPack) { setPreview(null); return; }
        fetch(apiUrl(`/frameworks/${frameworkKey}?action=preview&packKey=${selectedPack}`))
            .then(r => r.ok ? r.json() : null)
            .then(p => { setPreview(p); if (p) setStep('preview'); });
    }, [selectedPack, apiUrl, frameworkKey]);

    const handleInstall = async () => {
        setInstalling(true);
        setError('');
        try {
            const res = await fetch(apiUrl(`/frameworks/${frameworkKey}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packKey: selectedPack }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Install failed' }));
                setError(err.error || err.message || 'Install failed');
                return;
            }
            const data = await res.json();
            setResult(data);
            setStep('done');
        } catch (e: any) {
            setError(e.message || 'Network error');
        } finally {
            setInstalling(false);
        }
    };

    if (loading) return <div className="p-8 animate-pulse text-content-muted">Loading install wizard...</div>;
    if (!framework) return <div className="p-8 text-content-error">Framework not found</div>;

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <Link href={tenantHref(`/frameworks/${frameworkKey}`)} className="text-content-muted hover:text-content-emphasis transition-colors text-sm">
                    ← Back to {framework.name}
                </Link>
                <h1 className="text-2xl font-bold text-content-emphasis mt-2" id="install-wizard-heading">
                    Install {framework.name} Pack
                </h1>
                <p className="text-sm text-content-muted mt-1">
                    This will create controls, tasks, and requirement mappings for your tenant.
                </p>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs">
                {['Select Pack', 'Preview', 'Install'].map((s, i) => (
                    <div key={s} className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 && step === 'select' ? 'bg-brand-600 text-content-emphasis' :
                                i === 1 && step === 'preview' ? 'bg-brand-600 text-content-emphasis' :
                                    i === 2 && step === 'done' ? 'bg-bg-success-emphasis text-content-emphasis' :
                                        step === 'done' || (step === 'preview' && i === 0) ? 'bg-bg-success text-content-success' :
                                            'bg-bg-elevated text-content-subtle'
                            }`}>{i + 1}</div>
                        <span className="text-content-muted">{s}</span>
                        {i < 2 && <span className="text-content-subtle">→</span>}
                    </div>
                ))}
            </div>

            {/* Step 1: Select Pack */}
            {step === 'select' && (
                <div className="glass-card space-y-4">
                    <h2 className="text-lg font-semibold text-content-emphasis">Select a Pack</h2>
                    {packs.length === 0 ? (
                        <p className="text-content-subtle">No packs available for this framework.</p>
                    ) : (
                        <div className="space-y-2">
                            {packs.map(p => (
                                <label key={p.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedPack === p.key ? 'border-[var(--brand-default)] bg-[var(--brand-subtle)]' : 'border-border-default hover:border-border-emphasis'
                                    }`}>
                                    <input
                                        type="radio"
                                        name="pack"
                                        value={p.key}
                                        checked={selectedPack === p.key}
                                        onChange={() => setSelectedPack(p.key)}
                                        className="accent-[var(--brand-default)]"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-content-emphasis">{p.name}</div>
                                        <div className="text-xs text-content-subtle">{p._count?.templateLinks || 0} templates • v{p.version || 'latest'}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Step 2: Preview */}
            {step === 'preview' && preview && (
                <div className="space-y-4">
                    <div className="glass-card">
                        <h2 className="text-lg font-semibold text-content-emphasis mb-4">Install Preview</h2>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div className="text-center p-3 rounded-lg bg-bg-default/50">
                                <div className="text-2xl font-bold text-[var(--brand-default)]" id="preview-new-controls">{preview.newControls}</div>
                                <div className="text-xs text-content-muted">New Controls</div>
                            </div>
                            <div className="text-center p-3 rounded-lg bg-bg-default/50">
                                <div className="text-2xl font-bold text-content-warning">{preview.existingControls}</div>
                                <div className="text-xs text-content-muted">Already Exist</div>
                            </div>
                            <div className="text-center p-3 rounded-lg bg-bg-default/50">
                                <div className="text-2xl font-bold text-content-default">{preview.totalTemplates}</div>
                                <div className="text-xs text-content-muted">Total Templates</div>
                            </div>
                        </div>

                        {/* Template list */}
                        <div className="max-h-64 overflow-y-auto space-y-1 border-t border-border-default/50 pt-3">
                            {preview.templates?.map((t: any) => (
                                <div key={t.code} className="flex items-center gap-3 px-3 py-1.5 rounded-md text-sm">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.alreadyInstalled ? 'bg-bg-success-emphasis' : 'bg-[var(--brand-default)]'}`} />
                                    <code className="text-xs text-content-subtle font-mono w-24 flex-shrink-0">{t.code}</code>
                                    <span className="text-content-default flex-1">{t.title}</span>
                                    {t.alreadyInstalled && <span className="text-xs text-content-success">exists</span>}
                                    {!t.alreadyInstalled && <span className="text-xs text-[var(--brand-default)]">{t.tasks} tasks</span>}
                                </div>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="glass-card border-border-error bg-bg-error text-content-error text-sm">{error}</div>
                    )}

                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={() => { setStep('select'); setSelectedPack(''); }}>
                            ← Back
                        </Button>
                        <Button
                            variant="primary"
                            className="flex-1"
                            onClick={handleInstall}
                            disabled={installing || preview.newControls === 0}
                            id="confirm-install-btn"
                        >
                            {installing ? (
                                <span className="flex items-center gap-2">
                                    Installing...
                                </span>
                            ) : preview.newControls === 0 ? (
                                'All controls already installed'
                            ) : (
                                `Install ${preview.newControls} Controls`
                            )}
                        </Button>
                    </div>
                </div>
            )}

            {/* Step 3: Done */}
            {step === 'done' && result && (
                <div className="glass-card text-center space-y-4" id="install-result">
                    <div className="text-4xl"></div>
                    <h2 className="text-xl font-bold text-content-emphasis">Pack Installed Successfully!</h2>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 rounded-lg bg-bg-success">
                            <div className="text-2xl font-bold text-content-success" id="result-controls">{result.controlsCreated}</div>
                            <div className="text-xs text-content-muted">Controls Created</div>
                        </div>
                        <div className="p-3 rounded-lg bg-[var(--brand-subtle)]">
                            <div className="text-2xl font-bold text-[var(--brand-default)]" id="result-tasks">{result.tasksCreated}</div>
                            <div className="text-xs text-content-muted">Tasks Created</div>
                        </div>
                        <div className="p-3 rounded-lg bg-purple-500/10">
                            <div className="text-2xl font-bold text-purple-400" id="result-mappings">{result.mappingsCreated}</div>
                            <div className="text-xs text-content-muted">Mappings Created</div>
                        </div>
                    </div>
                    <div className="flex gap-3 justify-center">
                        <Link href={tenantHref('/controls')} className={buttonVariants({ variant: 'primary' })} id="go-to-controls">
                            View Controls →
                        </Link>
                        <Link href={tenantHref(`/frameworks/${frameworkKey}`)} className={buttonVariants({ variant: 'secondary' })}>
                            Back to Framework
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
