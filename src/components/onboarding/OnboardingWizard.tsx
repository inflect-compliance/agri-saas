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
import { StatusBadge } from '@/components/ui/status-badge';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';
import { InlineNotice } from '@/components/ui/inline-notice';

// ─── Step Definitions ───
//
// Elevation PR-6 — per-step gradient strings retired. Step icons
// render in the canonical state colours (muted at rest, brand when
// active, success when completed).
const STEPS = [
    { key: 'COMPANY_PROFILE', label: 'Company Profile', icon: Building2 },
    { key: 'FRAMEWORK_SELECTION', label: 'Frameworks', icon: Map },
    { key: 'ASSET_SETUP', label: 'Assets', icon: Server },
    { key: 'CONTROL_BASELINE_INSTALL', label: 'Controls', icon: ShieldCheck },
    { key: 'INITIAL_RISK_REGISTER', label: 'Risks', icon: AlertTriangle },
    { key: 'TEAM_SETUP', label: 'Team', icon: Users },
    { key: 'REVIEW_AND_FINISH', label: 'Review & Finish', icon: CheckCircle2 },
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
                <Card className="text-center max-w-md">
                    <ShieldCheck className="w-12 h-12 text-content-subtle mx-auto mb-4" />
                    <Heading level={2} className="text-content-emphasis mb-2">Access Restricted</Heading>
                    <p className="text-sm text-content-muted">Only tenant administrators can access the onboarding wizard.</p>
                </Card>
            </div>
        );
    }

    // ─── Loading skeleton ───
    if (loading) {
        return (
            <div className="space-y-section animate-fadeIn">
                <div className="h-8 w-48 bg-bg-default rounded animate-pulse" />
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-section">
                    <div className="h-96 bg-bg-default/50 rounded-xl animate-pulse" />
                    <div className="lg:col-span-3 h-96 bg-bg-default/50 rounded-xl animate-pulse" />
                </div>
            </div>
        );
    }

    // ─── Success banner ───
    if (successBanner) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] animate-fadeIn">
                <div className="glass-card p-10 text-center max-w-lg">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-success-emphasis flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-content-inverted" />
                    </div>
                    <Heading level={2} className="text-content-inverted mb-2">Onboarding Complete!</Heading>
                    <p className="text-content-muted text-sm">Your workspace is ready. Redirecting to dashboard...</p>
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
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--brand-default)] flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-content-inverted" />
                    </div>
                    <Heading level={2} className="text-content-inverted mb-2">Welcome! Let&apos;s set up your workspace.</Heading>
                    <p className="text-content-muted text-sm mb-6">This wizard will guide you through configuring your compliance platform in just a few steps.</p>
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
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-success-emphasis flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-content-inverted" />
                    </div>
                    <Heading level={2} className="text-content-inverted mb-2">Onboarding Complete</Heading>
                    <p className="text-content-muted text-sm mb-6">Your workspace has been configured. You can always update settings from the admin panel.</p>
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
        <div className="space-y-default animate-fadeIn" data-testid="onboarding-wizard">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-compact">
                <div>
                    <Heading level={1}>Setup Wizard</Heading>
                    <p className="text-content-muted text-sm mt-1">Complete these steps to configure your compliance workspace.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleSaveAndExit}>
                    <Save className="w-3.5 h-3.5" /> Save & Exit
                </Button>
            </div>

            {error && (
                <div className="glass-card border-border-error p-3 text-sm text-content-error flex items-center gap-tight">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto text-content-error hover:text-content-inverted text-xs">&times;</button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-section">
                {/* ─── Progress Sidebar ─── */}
                <div className="glass-card p-0 overflow-hidden">
                    <div className="p-4 border-b border-border-subtle">
                        <p className="text-xs text-content-muted font-medium uppercase tracking-wider">Progress</p>
                        <div className="flex items-center gap-tight mt-2">
                            <div className="flex-1 bg-bg-default rounded-full h-2 overflow-hidden">
                                <div className="h-full bg-[var(--brand-default)] rounded-full transition-all duration-500"
                                    style={{ width: `${(state.completedSteps.length / STEPS.length) * 100}%` }} />
                            </div>
                            <span className="text-xs text-content-muted font-medium">{state.completedSteps.length}/{STEPS.length}</span>
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
                                    className={`w-full flex items-center gap-compact px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ease-out ${
                                        active ? 'bg-brand-subtle text-content-inverted font-medium' : 'text-content-muted hover:text-content-emphasis hover:bg-bg-muted/30'
                                    }`}
                                >
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        completed ? 'bg-bg-success' : active ? `bg-[var(--brand-default)]` : 'bg-bg-muted/50'
                                    }`}>
                                        {completed ? (
                                            <CheckCircle2 className="w-4 h-4 text-content-success" />
                                        ) : (
                                            <Icon className={`w-3.5 h-3.5 ${active ? 'text-content-inverted' : 'text-content-subtle'}`} />
                                        )}
                                    </div>
                                    <span className="truncate">{step.label}</span>
                                    {active && <ChevronRight className="w-3.5 h-3.5 ml-auto text-content-subtle" />}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                {/* ─── Step Content ─── */}
                <div className="lg:col-span-3">
                    <div className="glass-card">
                        <div className="p-5 border-b border-border-subtle flex items-center gap-compact">
                            <div className={`w-9 h-9 rounded-full bg-[var(--brand-default)] flex items-center justify-center`}>
                                <currentStep.icon className="w-4.5 h-4.5 text-content-inverted" />
                            </div>
                            <div>
                                <Heading level={2} className="text-content-inverted">{currentStep.label}</Heading>
                                <p className="text-xs text-content-muted">Step {activeStepIdx + 1} of {STEPS.length}</p>
                            </div>
                            {isComplete(currentStep.key) && (
                                <StatusBadge variant="success" className="ml-auto">Completed</StatusBadge>
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
                        <div className="p-4 border-t border-border-subtle flex items-center justify-between gap-compact">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setActiveStepIdx(Math.max(0, activeStepIdx - 1))}
                                disabled={activeStepIdx === 0}
                            >
                                <ChevronLeft className="w-3.5 h-3.5" /> Back
                            </Button>
                            <div className="flex items-center gap-tight">
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
                                        variant="primary"
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
        default: return <p className="text-content-muted">Unknown step</p>;
    }
}

// ─── COMPANY_PROFILE ───

function CompanyProfileStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    return (
        <div className="space-y-default max-w-lg animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">Tell us about your organization. This information helps tailor your compliance experience.</p>
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
            <div className="grid grid-cols-2 gap-compact">
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
        <div className="space-y-default animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">Select the compliance frameworks you want to implement. You can add more later.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                {frameworks.map(fw => {
                    const active = selected.includes(fw.key);
                    return (
                        <button key={fw.key} onClick={() => toggle(fw.key)} data-testid={`fw-${fw.key}`}
                            className={`text-left p-4 rounded-xl border-2 transition-colors duration-150 ease-out ${
                                active ? 'border-[var(--brand-default)] bg-brand-subtle' : 'border-border-subtle bg-bg-default/30 hover:border-border-default'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-content-inverted text-sm">{fw.name}</span>
                                {fw.badge && <StatusBadge variant="info" size="sm">{fw.badge}</StatusBadge>}
                            </div>
                            <p className="text-xs text-content-muted leading-relaxed">{fw.desc}</p>
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
        <div className="space-y-default max-w-lg animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">Add your key information assets. These are the systems, databases, and services you need to protect.</p>
            <div className="flex gap-tight">
                <input className="input flex-1" placeholder="e.g. Customer Database, Cloud Infrastructure..." value={newAsset}
                    onChange={(e) => setNewAsset(e.target.value)} onKeyDown={assetKeyDown} data-testid="asset-input" />
                <Button variant="primary" onClick={addAsset}>Add</Button>
            </div>
            {assets.length > 0 && (
                <div className="space-y-1">
                    {assets.map(a => (
                        <div key={a} className="flex items-center justify-between bg-bg-default/50 rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-tight">
                                <Server className="w-3.5 h-3.5 text-content-subtle" />
                                <span className="text-content-emphasis">{a}</span>
                            </div>
                            <button onClick={() => removeAsset(a)} className="text-content-subtle hover:text-content-error text-xs">&times;</button>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-xs text-content-subtle">You can import assets in bulk later from the Assets page.</p>
        </div>
    );
}

// ─── CONTROL_BASELINE_INSTALL ───

function ControlInstallStep({ data, onUpdate, allData }: { data: StepData; onUpdate: (d: StepData) => void; allData: StepData }) {
    const selectedFrameworks: string[] = allData['FRAMEWORK_SELECTION']?.selectedFrameworks || [];
    const fwLabels: Record<string, string> = { iso27001: 'ISO 27001:2022', nis2: 'NIS2 Directive' };

    return (
        <div className="space-y-default max-w-lg animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">We&apos;ll install baseline controls from your selected frameworks. This creates your initial control register.</p>
            {selectedFrameworks.length === 0 ? (
                <InlineNotice variant="warning" icon={null}>
                    No frameworks selected. Go back to the Frameworks step to select at least one.
                </InlineNotice>
            ) : (
                <div className="space-y-compact">
                    {selectedFrameworks.map(fw => (
                        <div key={fw} className="flex items-center gap-compact p-3 bg-bg-default/50 rounded-lg">
                            <ShieldCheck className="w-5 h-5 text-brand-400" />
                            <div>
                                <span className="text-sm font-medium text-content-emphasis">{fwLabels[fw] || fw}</span>
                                <p className="text-xs text-content-subtle">Baseline controls will be installed</p>
                            </div>
                            <CheckCircle2 className="w-4 h-4 text-content-success ml-auto" />
                        </div>
                    ))}
                </div>
            )}
            <label className="flex items-center gap-tight text-sm text-content-default cursor-pointer">
                <input type="checkbox" checked={data.confirmed || false} onChange={(e) => onUpdate({ confirmed: e.target.checked })}
                    className="w-4 h-4 rounded border-border-default bg-bg-default text-brand-500 focus:ring-brand-500" />
                I confirm installing baseline controls
            </label>
        </div>
    );
}

// ─── INITIAL_RISK_REGISTER ───

function RiskRegisterStep({ data, onUpdate }: { data: StepData; onUpdate: (d: StepData) => void }) {
    return (
        <div className="space-y-default max-w-lg animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">Generate a starter risk register based on your assets and selected frameworks.</p>
            <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-border-warning">
                <div className="flex items-center gap-compact mb-3">
                    <AlertTriangle className="w-5 h-5 text-content-warning" />
                    <span className="font-medium text-content-inverted text-sm">Starter Risk Register</span>
                </div>
                <p className="text-xs text-content-muted leading-relaxed">We&apos;ll generate common information security risks based on industry best practices. You can customize, add, or remove risks later.</p>
            </div>
            <label className="flex items-center gap-tight text-sm text-content-default cursor-pointer">
                <input type="checkbox" checked={data.generate !== false} onChange={(e) => onUpdate({ generate: e.target.checked })}
                    className="w-4 h-4 rounded border-border-default bg-bg-default text-brand-500 focus:ring-brand-500" />
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
        <div className="space-y-default max-w-lg animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">Invite your team members. They&apos;ll receive an email invitation to join your workspace.</p>
            <div className="flex gap-tight">
                <input className="input flex-1" placeholder="colleague@company.com" type="email" value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)} onKeyDown={emailKeyDown} data-testid="invite-email" />
                <Button variant="primary" onClick={addEmail}>Invite</Button>
            </div>
            {emails.length > 0 && (
                <div className="space-y-1">
                    {emails.map(e => (
                        <div key={e} className="flex items-center justify-between bg-bg-default/50 rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-tight">
                                <Users className="w-3.5 h-3.5 text-content-subtle" />
                                <span className="text-content-emphasis">{e}</span>
                            </div>
                            <button onClick={() => removeEmail(e)} className="text-content-subtle hover:text-content-error text-xs">&times;</button>
                        </div>
                    ))}
                </div>
            )}
            <p className="text-xs text-content-subtle">You can skip this step and invite team members later from the Admin panel.</p>
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
        <div className="space-y-default animate-fadeIn">
            <p className="text-sm text-content-muted mb-4">Review your setup before completing onboarding.</p>
            <div className="space-y-tight">
                {summaryItems.map(item => {
                    const done = completedSteps.includes(item.key);
                    return (
                        <div key={item.key} className="flex items-center gap-compact p-3 bg-bg-default/30 rounded-lg" data-testid={`review-${item.key}`}>
                            {done ? (
                                <CheckCircle2 className="w-5 h-5 text-content-success flex-shrink-0" />
                            ) : (
                                <div className="w-5 h-5 rounded-full border-2 border-border-default flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-content-emphasis">{item.label}</span>
                                <p className="text-xs text-content-subtle truncate">{item.detail}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
            <InlineNotice variant="success" icon={null}>
                Click &quot;Complete Setup&quot; below to finish onboarding and go to your dashboard.
            </InlineNotice>
        </div>
    );
}
