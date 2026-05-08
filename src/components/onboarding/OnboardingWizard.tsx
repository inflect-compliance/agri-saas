'use client';

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { useEnterSubmit } from '@/components/ui/hooks';
import {
    Building2,
    Map,
    Server,
    ShieldCheck,
    AlertTriangle,
    Users,
    CheckCircle2,
    ChevronRight,
    ChevronLeft,
    Loader2,
    Save,
    RotateCcw,
    Sparkles,
} from 'lucide-react';

// ─── Step Definitions ───

const STEPS = [
    { key: 'COMPANY_PROFILE', label: 'Company Profile', icon: Building2, color: 'from-blue-500 to-cyan-500' },
    { key: 'FRAMEWORK_SELECTION', label: 'Frameworks', icon: Map, color: 'from-indigo-500 to-purple-500' },
    { key: 'ASSET_SETUP', label: 'Assets', icon: Server, color: 'from-emerald-500 to-teal-500' },
    { key: 'CONTROL_BASELINE_INSTALL', label: 'Controls', icon: ShieldCheck, color: 'from-cyan-500 to-blue-500' },
    { key: 'INITIAL_RISK_REGISTER', label: 'Risks', icon: AlertTriangle, color: 'from-amber-500 to-orange-500' },
    { key: 'TEAM_SETUP', label: 'Team', icon: Users, color: 'from-pink-500 to-rose-500' },
    { key: 'REVIEW_AND_FINISH', label: 'Review & Finish', icon: CheckCircle2, color: 'from-emerald-500 to-green-500' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepData = Record<string, any>;

interface OnboardingState {
    status: string;
    currentStep: string;
    completedSteps: string[];
    stepData: StepData;
    startedAt: string | null;
    completedAt: string | null;
}

// ─── API helpers ───

function apiUrl(tenantSlug: string, path: string) {
    return `/api/t/${tenantSlug}/onboarding/${path}`;
}

async function apiFetch<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        const msg = typeof err.error === 'string' ? err.error
            : typeof err.message === 'string' ? err.message
            : JSON.stringify(err.error ?? err);
        throw new Error(msg || `HTTP ${res.status}`);
    }
    return res.json();
}

// ─── Main Wizard Component ───

export default function OnboardingWizard() {
    const { tenantSlug, permissions } = useTenantContext();
    const tenantHref = useTenantHref();
    const router = useRouter();

    const [state, setState] = useState<OnboardingState | null>(null);
    const [activeStepIdx, setActiveStepIdx] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [localData, setLocalData] = useState<StepData>({});
    const [successBanner, setSuccessBanner] = useState(false);

    // ─── Load state ───
    const loadState = useCallback(async () => {
        if (!permissions.canAdmin) return;
        try {
            setLoading(true);
            const s = await apiFetch<OnboardingState>(apiUrl(tenantSlug, 'state'));
            setState(s);
            setLocalData((s.stepData as StepData) || {});

            // Set active step to current
            const idx = STEPS.findIndex(st => st.key === s.currentStep);
            if (idx >= 0) setActiveStepIdx(idx);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load onboarding state');
        } finally {
            setLoading(false);
        }
    }, [tenantSlug, permissions.canAdmin]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { loadState(); }, [loadState]);

    // ─── Start onboarding ───
    const handleStart = async () => {
        try {
            setSaving(true);
            const s = await apiFetch<OnboardingState>(apiUrl(tenantSlug, 'start'), 'POST');
            setState(s);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start');
        } finally {
            setSaving(false);
        }
    };

    // ─── Save step data ───
    const handleSaveStep = async (step: StepKey, data: StepData) => {
        try {
            setSaving(true);
            setError(null);
            await apiFetch(apiUrl(tenantSlug, 'step'), 'POST', { step, action: 'save', data });
            setLocalData(prev => ({ ...prev, [step]: data }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    // ─── Complete step ───
    const handleCompleteStep = async (step: StepKey) => {
        try {
            setSaving(true);
            setError(null);
            // Save any local data first
            const stepLocalData = localData[step] || {};
            if (Object.keys(stepLocalData).length > 0) {
                await apiFetch(apiUrl(tenantSlug, 'step'), 'POST', { step, action: 'save', data: stepLocalData });
            }
            // Then complete
            const s = await apiFetch<OnboardingState>(apiUrl(tenantSlug, 'step'), 'POST', { step, action: 'complete' });
            setState(s);
            // Advance to next step
            const nextIdx = activeStepIdx + 1;
            if (nextIdx < STEPS.length) setActiveStepIdx(nextIdx);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to complete step');
        } finally {
            setSaving(false);
        }
    };

    // ─── Finish ───
    const handleFinish = async () => {
        try {
            setSaving(true);
            setError(null);
            // Complete the last step first
            await apiFetch(apiUrl(tenantSlug, 'step'), 'POST', { step: 'REVIEW_AND_FINISH', action: 'complete' });
            await apiFetch(apiUrl(tenantSlug, 'finish'), 'POST');
            setSuccessBanner(true);
            setTimeout(() => {
                router.push(tenantHref('/dashboard'));
            }, 2000);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to finish');
        } finally {
            setSaving(false);
        }
    };

    // ─── Save & exit ───
    const handleSaveAndExit = async () => {
        const currentStepKey = STEPS[activeStepIdx].key;
        const stepLocalData = localData[currentStepKey] || {};
        if (Object.keys(stepLocalData).length > 0) {
            await handleSaveStep(currentStepKey, stepLocalData);
        }
        router.push(tenantHref('/dashboard'));
    };

    // ─── Update local step data ───
    const updateStepData = (step: StepKey, data: StepData) => {
        setLocalData(prev => ({ ...prev, [step]: { ...(prev[step] || {}), ...data } }));
    };

    // ─── Admin guard (must be after all hooks) ───
    if (!permissions.canAdmin) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="glass-card p-8 text-center max-w-md">
                    <ShieldCheck className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                    <h2 className="text-lg font-semibold text-slate-200 mb-2">Access Restricted</h2>
                    <p className="text-sm text-slate-400">Only tenant administrators can access the onboarding wizard.</p>
                </div>
            </div>
        );
    }

    // ─── Loading skeleton ───
    if (loading) {
        return (
            <div className="space-y-6 animate-fadeIn">
                <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="h-96 bg-slate-800/50 rounded-xl animate-pulse" />
                    <div className="lg:col-span-3 h-96 bg-slate-800/50 rounded-xl animate-pulse" />
                </div>
            </div>
        );
    }

    // ─── Success banner ───
    if (successBanner) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] animate-fadeIn">
                <div className="glass-card p-10 text-center max-w-lg">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">Onboarding Complete!</h2>
                    <p className="text-slate-400 text-sm">Your workspace is ready. Redirecting to dashboard...</p>
                    <div className="mt-4">
                        <Loader2 className="w-5 h-5 mx-auto text-brand-400 animate-spin" />
                    </div>
                </div>
            </div>
        );
    }

    // ─── Not started ───
    if (!state || state.status === 'NOT_STARTED') {
        return (
            <div className="flex items-center justify-center min-h-[60vh] animate-fadeIn">
                <div className="glass-card p-10 text-center max-w-lg">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">Welcome! Let&apos;s set up your workspace.</h2>
                    <p className="text-slate-400 text-sm mb-6">This wizard will guide you through configuring your compliance platform in just a few steps.</p>
                    <Button variant="primary" size="lg" onClick={handleStart} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        Start Setup
                    </Button>
                </div>
            </div>
        );
    }

    // ─── Completed ───
    if (state.status === 'COMPLETED') {
        return (
            <div className="flex items-center justify-center min-h-[60vh] animate-fadeIn">
                <div className="glass-card p-10 text-center max-w-lg">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">Onboarding Complete</h2>
                    <p className="text-slate-400 text-sm mb-6">Your workspace has been configured. You can always update settings from the admin panel.</p>
                    <Button variant="primary" size="lg" onClick={() => router.push(tenantHref('/dashboard'))}>
                        Go to Dashboard
                    </Button>
                </div>
            </div>
        );
    }

    const currentStep = STEPS[activeStepIdx];
    const isComplete = (key: string) => state.completedSteps.includes(key);
    const isLast = activeStepIdx === STEPS.length - 1;

    return (
        <div className="space-y-4 animate-fadeIn" data-testid="onboarding-wizard">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Setup Wizard</h1>
                    <p className="text-slate-400 text-sm mt-1">Complete these steps to configure your compliance workspace.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleSaveAndExit}>
                    <Save className="w-3.5 h-3.5" /> Save & Exit
                </Button>
            </div>

            {error && (
                <div className="glass-card border-border-error p-3 text-sm text-content-error flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto text-content-error hover:text-white text-xs">&times;</button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* ─── Progress Sidebar ─── */}
                <div className="glass-card p-0 overflow-hidden">
                    <div className="p-4 border-b border-slate-700/50">
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Progress</p>
                        <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-brand-500 to-emerald-500 rounded-full transition-all duration-500"
                                    style={{ width: `${(state.completedSteps.length / STEPS.length) * 100}%` }} />
                            </div>
                            <span className="text-xs text-slate-400 font-medium">{state.completedSteps.length}/{STEPS.length}</span>
                        </div>
                    </div>
                    <nav className="p-2">
                        {STEPS.map((step, i) => {
                            const Icon = step.icon;
                            const completed = isComplete(step.key);
                            const active = i === activeStepIdx;
                            return (
                                <button key={step.key}
                                    onClick={() => setActiveStepIdx(i)}
                                    data-testid={`step-nav-${step.key}`}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                                        active ? 'bg-brand-600/20 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                                    }`}
                                >
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        completed ? 'bg-bg-success' : active ? `bg-gradient-to-br ${step.color} opacity-80` : 'bg-slate-700/50'
                                    }`}>
                                        {completed ? (
                                            <CheckCircle2 className="w-4 h-4 text-content-success" />
                                        ) : (
                                            <Icon className={`w-3.5 h-3.5 ${active ? 'text-white' : 'text-slate-500'}`} />
                                        )}
                                    </div>
                                    <span className="truncate">{step.label}</span>
                                    {active && <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-500" />}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                {/* ─── Step Content ─── */}
                <div className="lg:col-span-3">
                    <div className="glass-card">
                        <div className="p-5 border-b border-slate-700/50 flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${currentStep.color} flex items-center justify-center`}>
                                <currentStep.icon className="w-4.5 h-4.5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-white">{currentStep.label}</h2>
                                <p className="text-xs text-slate-400">Step {activeStepIdx + 1} of {STEPS.length}</p>
                            </div>
                            {isComplete(currentStep.key) && (
                                <span className="badge badge-success ml-auto">Completed</span>
                            )}
                        </div>
                        <div className="p-5">
                            <StepContent
                                step={currentStep.key}
                                data={localData[currentStep.key] || {}}
                                onUpdate={(data) => updateStepData(currentStep.key, data)}
                                completedSteps={state.completedSteps}
                                allData={localData}
                            />
                        </div>
                        {/* Navigation footer */}
                        <div className="p-4 border-t border-slate-700/50 flex items-center justify-between gap-3">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setActiveStepIdx(Math.max(0, activeStepIdx - 1))}
                                disabled={activeStepIdx === 0}
                            >
                                <ChevronLeft className="w-3.5 h-3.5" /> Back
                            </Button>
                            <div className="flex items-center gap-2">
                                {!isLast && (
                                    <Button
                                        variant="primary"
                                        onClick={() => handleCompleteStep(currentStep.key)}
                                        disabled={saving}
                                    >
                                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                        Continue <ChevronRight className="w-3.5 h-3.5" />
                                    </Button>
                                )}
                                {isLast && (
                                    <Button
                                        variant="success"
                                        size="lg"
                                        onClick={handleFinish}
                                        disabled={saving}
                                    >
                                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                        Complete Setup
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Step Content Components ───

function StepContent({ step, data, onUpdate, completedSteps, allData }: {
    step: StepKey;
    data: StepData;
    onUpdate: (d: StepData) => void;
    completedSteps: string[];
    allData: StepData;
}) {
    switch (step) {
        case 'COMPANY_PROFILE': return <CompanyProfileStep data={data} onUpdate={onUpdate} />;
        case 'FRAMEWORK_SELECTION': return <FrameworkSelectionStep data={data} onUpdate={onUpdate} />;
        case 'ASSET_SETUP': return <AssetSetupStep data={data} onUpdate={onUpdate} />;
        case 'CONTROL_BASELINE_INSTALL': return <ControlInstallStep data={data} onUpdate={onUpdate} allData={allData} />;
        case 'INITIAL_RISK_REGISTER': return <RiskRegisterStep data={data} onUpdate={onUpdate} />;
        case 'TEAM_SETUP': return <TeamSetupStep data={data} onUpdate={onUpdate} />;
        case 'REVIEW_AND_FINISH': return <ReviewStep completedSteps={completedSteps} allData={allData} />;
        default: return <p className="text-slate-400">Unknown step</p>;
    }
}

// ─── COMPANY_PROFILE ───

function CompanyProfileStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    return (
        <div className="space-y-4 max-w-lg animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">Tell us about your organization. This information helps tailor your compliance experience.</p>
            <div>
                <label className="input-label">Company / Legal Name *</label>
                <input className="input" placeholder="Acme Corporation" value={data.name || ''}
                    onChange={(e) => onUpdate({ name: e.target.value })} data-testid="company-name" />
            </div>
            <div>
                <label className="input-label">Industry</label>
                <Combobox
                    hideSearch
                    selected={[
                        { value: 'technology', label: 'Technology' },
                        { value: 'finance', label: 'Finance & Banking' },
                        { value: 'healthcare', label: 'Healthcare' },
                        { value: 'manufacturing', label: 'Manufacturing' },
                        { value: 'government', label: 'Government' },
                        { value: 'energy', label: 'Energy & Utilities' },
                        { value: 'retail', label: 'Retail & E-commerce' },
                        { value: 'other', label: 'Other' },
                    ].find(o => o.value === (data.industry || '')) ?? null}
                    setSelected={(opt) => onUpdate({ industry: opt?.value ?? '' })}
                    options={[
                        { value: 'technology', label: 'Technology' },
                        { value: 'finance', label: 'Finance & Banking' },
                        { value: 'healthcare', label: 'Healthcare' },
                        { value: 'manufacturing', label: 'Manufacturing' },
                        { value: 'government', label: 'Government' },
                        { value: 'energy', label: 'Energy & Utilities' },
                        { value: 'retail', label: 'Retail & E-commerce' },
                        { value: 'other', label: 'Other' },
                    ]}
                    placeholder="Select industry..."
                    matchTriggerWidth
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="input-label">Country</label>
                    <input className="input" placeholder="e.g. Germany" value={data.country || ''}
                        onChange={(e) => onUpdate({ country: e.target.value })} />
                </div>
                <div>
                    <label className="input-label">Company Size</label>
                    <Combobox
                        hideSearch
                        selected={[
                            { value: '1-50', label: '1–50 employees' },
                            { value: '51-200', label: '51–200 employees' },
                            { value: '201-1000', label: '201–1,000 employees' },
                            { value: '1000+', label: '1,000+ employees' },
                        ].find(o => o.value === (data.size || '')) ?? null}
                        setSelected={(opt) => onUpdate({ size: opt?.value ?? '' })}
                        options={[
                            { value: '1-50', label: '1–50 employees' },
                            { value: '51-200', label: '51–200 employees' },
                            { value: '201-1000', label: '201–1,000 employees' },
                            { value: '1000+', label: '1,000+ employees' },
                        ]}
                        placeholder="Select..."
                        matchTriggerWidth
                    />
                </div>
            </div>
        </div>
    );
}

// ─── FRAMEWORK_SELECTION ───

function FrameworkSelectionStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    const frameworks = [
        { key: 'iso27001', name: 'ISO 27001:2022', desc: 'International information security management standard. Installs 93 controls across 4 domains.', badge: 'Most Popular' },
        { key: 'nis2', name: 'NIS2 Directive', desc: 'EU cybersecurity directive for essential and important entities. Installs sector-specific requirements.', badge: 'EU Required' },
    ];
    const selected: string[] = data.selectedFrameworks || [];

    const toggle = (key: string) => {
        const next = selected.includes(key) ? selected.filter(s => s !== key) : [...selected, key];
        onUpdate({ selectedFrameworks: next });
    };

    return (
        <div className="space-y-4 animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">Select the compliance frameworks you want to implement. You can add more later.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {frameworks.map(fw => {
                    const active = selected.includes(fw.key);
                    return (
                        <button key={fw.key} onClick={() => toggle(fw.key)} data-testid={`fw-${fw.key}`}
                            className={`text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                                active ? 'border-brand-500 bg-brand-600/10' : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-white text-sm">{fw.name}</span>
                                {fw.badge && <span className="badge badge-info text-[10px]">{fw.badge}</span>}
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">{fw.desc}</p>
                            {active && <div className="mt-2 flex items-center gap-1 text-brand-400 text-xs font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Selected</div>}
                        </button>
                    );
                })}
            </div>
            {selected.length === 0 && <p className="text-xs text-content-warning">Select at least one framework to continue.</p>}
        </div>
    );
}

// ─── ASSET_SETUP ───

function AssetSetupStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    const assets: string[] = data.assets || [];
    const [newAsset, setNewAsset] = useState('');

    const addAsset = () => {
        if (newAsset.trim() && !assets.includes(newAsset.trim())) {
            const next = [...assets, newAsset.trim()];
            onUpdate({ assets: next });
            setNewAsset('');
        }
    };

    // Epic 60 — useEnterSubmit replaces the inline
    // `onKeyDown={(e) => e.key === 'Enter' && addAsset()}`. Wins: IME
    // composition guard (no phantom adds mid-candidate), Shift+Enter
    // preserved for paste-with-newlines, disabled opt-out plumbed.
    const { handleKeyDown: assetKeyDown } = useEnterSubmit({ onSubmit: addAsset });

    const removeAsset = (name: string) => {
        onUpdate({ assets: assets.filter(a => a !== name) });
    };

    return (
        <div className="space-y-4 max-w-lg animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">Add your key information assets. These are the systems, databases, and services you need to protect.</p>
            <div className="flex gap-2">
                <input className="input flex-1" placeholder="e.g. Customer Database, Cloud Infrastructure..." value={newAsset}
                    onChange={(e) => setNewAsset(e.target.value)} onKeyDown={assetKeyDown} data-testid="asset-input" />
                <Button variant="primary" onClick={addAsset}>Add</Button>
            </div>
            {assets.length > 0 && (
                <div className="space-y-1">
                    {assets.map(a => (
                        <div key={a} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                                <Server className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-slate-200">{a}</span>
                            </div>
                            <button onClick={() => removeAsset(a)} className="text-slate-500 hover:text-content-error text-xs">&times;</button>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-xs text-slate-500">You can import assets in bulk later from the Assets page.</p>
        </div>
    );
}

// ─── CONTROL_BASELINE_INSTALL ───

function ControlInstallStep({ data, onUpdate, allData }: { data: StepData; onUpdate: (d: StepData) => void; allData: StepData }) {
    const selectedFrameworks: string[] = allData['FRAMEWORK_SELECTION']?.selectedFrameworks || [];
    const fwLabels: Record<string, string> = { iso27001: 'ISO 27001:2022', nis2: 'NIS2 Directive' };

    return (
        <div className="space-y-4 max-w-lg animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">We&apos;ll install baseline controls from your selected frameworks. This creates your initial control register.</p>
            {selectedFrameworks.length === 0 ? (
                <div className="p-4 rounded-lg bg-bg-warning border border-border-warning text-sm text-content-warning">
                    No frameworks selected. Go back to the Frameworks step to select at least one.
                </div>
            ) : (
                <div className="space-y-3">
                    {selectedFrameworks.map(fw => (
                        <div key={fw} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                            <ShieldCheck className="w-5 h-5 text-brand-400" />
                            <div>
                                <span className="text-sm font-medium text-slate-200">{fwLabels[fw] || fw}</span>
                                <p className="text-xs text-slate-500">Baseline controls will be installed</p>
                            </div>
                            <CheckCircle2 className="w-4 h-4 text-content-success ml-auto" />
                        </div>
                    ))}
                </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={data.confirmed || false} onChange={(e) => onUpdate({ confirmed: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-brand-500 focus:ring-brand-500" />
                I confirm installing baseline controls
            </label>
        </div>
    );
}

// ─── INITIAL_RISK_REGISTER ───

function RiskRegisterStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    return (
        <div className="space-y-4 max-w-lg animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">Generate a starter risk register based on your assets and selected frameworks.</p>
            <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-border-warning">
                <div className="flex items-center gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-content-warning" />
                    <span className="font-medium text-white text-sm">Starter Risk Register</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">We&apos;ll generate common information security risks based on industry best practices. You can customize, add, or remove risks later.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={data.generate !== false} onChange={(e) => onUpdate({ generate: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-brand-500 focus:ring-brand-500" />
                Generate starter risks
            </label>
        </div>
    );
}

// ─── TEAM_SETUP ───

function TeamSetupStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    const emails: string[] = data.inviteEmails || [];
    const [newEmail, setNewEmail] = useState('');

    const addEmail = () => {
        const email = newEmail.trim().toLowerCase();
        if (email && email.includes('@') && !emails.includes(email)) {
            onUpdate({ inviteEmails: [...emails, email] });
            setNewEmail('');
        }
    };

    // Epic 60 — same Enter-submit story as the asset input above.
    const { handleKeyDown: emailKeyDown } = useEnterSubmit({ onSubmit: addEmail });

    const removeEmail = (email: string) => {
        onUpdate({ inviteEmails: emails.filter(e => e !== email) });
    };

    return (
        <div className="space-y-4 max-w-lg animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">Invite your team members. They&apos;ll receive an email invitation to join your workspace.</p>
            <div className="flex gap-2">
                <input className="input flex-1" placeholder="colleague@company.com" type="email" value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)} onKeyDown={emailKeyDown} data-testid="invite-email" />
                <Button variant="primary" onClick={addEmail}>Invite</Button>
            </div>
            {emails.length > 0 && (
                <div className="space-y-1">
                    {emails.map(e => (
                        <div key={e} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                                <Users className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-slate-200">{e}</span>
                            </div>
                            <button onClick={() => removeEmail(e)} className="text-slate-500 hover:text-content-error text-xs">&times;</button>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-xs text-slate-500">You can skip this step and invite team members later from the Admin panel.</p>
        </div>
    );
}

// ─── REVIEW_AND_FINISH ───

function ReviewStep({ completedSteps, allData }: { completedSteps: string[]; allData: StepData }) {
    const summaryItems = [
        { key: 'COMPANY_PROFILE', label: 'Company Profile', detail: allData['COMPANY_PROFILE']?.name || 'Not configured' },
        { key: 'FRAMEWORK_SELECTION', label: 'Frameworks', detail: (allData['FRAMEWORK_SELECTION']?.selectedFrameworks || []).join(', ') || 'None selected' },
        { key: 'ASSET_SETUP', label: 'Assets', detail: `${(allData['ASSET_SETUP']?.assets || []).length} assets added` },
        { key: 'CONTROL_BASELINE_INSTALL', label: 'Controls', detail: allData['CONTROL_BASELINE_INSTALL']?.confirmed ? 'Baseline install confirmed' : 'Pending confirmation' },
        { key: 'INITIAL_RISK_REGISTER', label: 'Risk Register', detail: allData['INITIAL_RISK_REGISTER']?.generate !== false ? 'Starter risks will be generated' : 'Skipped' },
        { key: 'TEAM_SETUP', label: 'Team', detail: `${(allData['TEAM_SETUP']?.inviteEmails || []).length} invitations pending` },
    ];

    return (
        <div className="space-y-4 animate-fadeIn">
            <p className="text-sm text-slate-400 mb-4">Review your setup before completing onboarding.</p>
            <div className="space-y-2">
                {summaryItems.map(item => {
                    const done = completedSteps.includes(item.key);
                    return (
                        <div key={item.key} className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-lg" data-testid={`review-${item.key}`}>
                            {done ? (
                                <CheckCircle2 className="w-5 h-5 text-content-success flex-shrink-0" />
                            ) : (
                                <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-slate-200">{item.label}</span>
                                <p className="text-xs text-slate-500 truncate">{item.detail}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="p-4 rounded-lg bg-bg-success border border-border-success text-sm text-content-success">
                Click &quot;Complete Setup&quot; below to finish onboarding and go to your dashboard.
            </div>
        </div>
    );
}
