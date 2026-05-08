'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AppIcon } from '@/components/icons/AppIcon';
import { Button } from '@/components/ui/button';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';

interface TestPlan {
    id: string;
    name: string;
    method: string;
    frequency: string;
    status: string;
    nextDueAt: string | null;
    owner?: { id: string; name: string | null; email: string } | null;
    _count?: { runs: number; steps: number };
    runs?: Array<{
        id: string;
        result: string | null;
        executedAt: string | null;
        status: string;
    }>;
}

const FREQ_LABELS: Record<string, string> = {
    AD_HOC: 'Ad Hoc', DAILY: 'Daily', WEEKLY: 'Weekly',
    MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually',
};
const RESULT_BADGE: Record<string, string> = {
    PASS: 'badge-success', FAIL: 'badge-danger', INCONCLUSIVE: 'badge-warning',
};
const STATUS_BADGE: Record<string, string> = {
    ACTIVE: 'badge-success', PAUSED: 'badge-warning',
};

export default function TestPlansPanel({ controlId }: { controlId: string }) {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();

    const [plans, setPlans] = useState<TestPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [frequency, setFrequency] = useState('QUARTERLY');
    const [method, setMethod] = useState('MANUAL');
    const [saving, setSaving] = useState(false);
    const [creatingRunFor, setCreatingRunFor] = useState<string | null>(null);

    const fetchPlans = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/controls/${controlId}/tests/plans`));
            if (res.ok) setPlans(await res.json());
        } finally {
            setLoading(false);
        }
    }, [apiUrl, controlId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchPlans(); }, [fetchPlans]);

    const createPlan = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const res = await fetch(apiUrl(`/controls/${controlId}/tests/plans`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, frequency, method }),
            });
            if (res.ok) {
                setShowForm(false);
                setName('');
                await fetchPlans();
            }
        } finally {
            setSaving(false);
        }
    };

    const createRun = async (planId: string) => {
        setCreatingRunFor(planId);
        try {
            const res = await fetch(apiUrl(`/tests/plans/${planId}/runs`), { method: 'POST' });
            if (res.ok) {
                const run = await res.json();
                window.location.href = tenantHref(`/tests/runs/${run.id}`);
            }
        } finally {
            setCreatingRunFor(null);
        }
    };

    const getLastRun = (plan: TestPlan) => {
        if (!plan.runs || plan.runs.length === 0) return null;
        return plan.runs[0];
    };

    const isOverdue = (d: string | null) => {
        if (!d) return false;
        return new Date(d) < new Date();
    };

    if (loading) return <div className="animate-pulse text-content-subtle text-sm py-4">Loading test plans...</div>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-content-default">Test Plans</h3>
                {permissions.canWrite && (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setShowForm(!showForm)}
                        id="create-test-plan-btn"
                    >
                        {showForm ? 'Cancel' : '+ New Test Plan'}
                    </Button>
                )}
            </div>

            {showForm && (
                <div className="glass-card p-4 space-y-3 animate-fadeIn">
                    <div>
                        <label className="text-xs text-content-muted block mb-1">Plan Name *</label>
                        <input
                            className="input w-full"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g., Quarterly access review"
                            id="test-plan-name-input"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Frequency</label>
                            <select className="input w-full" value={frequency} onChange={e => setFrequency(e.target.value)} id="test-plan-frequency-select">
                                {Object.entries(FREQ_LABELS).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Method</label>
                            <select className="input w-full" value={method} onChange={e => setMethod(e.target.value)} id="test-plan-method-select">
                                <option value="MANUAL">Manual</option>
                                <option value="AUTOMATED">Automated</option>
                            </select>
                        </div>
                    </div>
                    <Button variant="primary" size="sm" onClick={createPlan} disabled={saving || !name.trim()} id="save-test-plan-btn">
                        {saving ? 'Creating...' : <><AppIcon name="save" size={14} className="inline-block mr-1" /> Create Plan</>}
                    </Button>
                </div>
            )}

            {plans.length === 0 && !showForm && (
                <div className="text-sm text-content-subtle py-4">No test plans configured for this control.</div>
            )}

            {plans.length > 0 && (
                <div className="divide-y divide-slate-700/50">
                    {plans.map(plan => {
                        const lastRun = getLastRun(plan);
                        return (
                            <div key={plan.id} className="py-3 flex items-center justify-between group hover:bg-bg-default/30 px-2 rounded transition">
                                <div className="flex-1 min-w-0">
                                    <Link
                                        href={tenantHref(`/controls/${controlId}/tests/${plan.id}`)}
                                        className="text-sm font-medium text-white hover:text-[var(--brand-default)] transition"
                                        id={`test-plan-link-${plan.id}`}
                                    >
                                        {plan.name}
                                    </Link>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className={`badge badge-xs ${STATUS_BADGE[plan.status] || 'badge-neutral'}`}>
                                            {plan.status}
                                        </span>
                                        <span className="text-xs text-content-subtle">{FREQ_LABELS[plan.frequency] || plan.frequency}</span>
                                        <span className="text-xs text-content-subtle">•</span>
                                        <span className="text-xs text-content-subtle">{plan.method}</span>
                                        {plan.nextDueAt && (
                                            <>
                                                <span className="text-xs text-content-subtle">•</span>
                                                <span className={`text-xs ${isOverdue(plan.nextDueAt) ? 'text-content-error font-semibold' : 'text-content-muted'}`}>
                                                    Due: {formatDate(plan.nextDueAt)}
                                                </span>
                                            </>
                                        )}
                                        {plan.owner && (
                                            <>
                                                <span className="text-xs text-content-subtle">•</span>
                                                <span className="text-xs text-content-muted">{plan.owner.name || plan.owner.email}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                    {lastRun?.result && (
                                        <span className={`badge badge-xs ${RESULT_BADGE[lastRun.result] || 'badge-neutral'}`}>
                                            {lastRun.result}
                                        </span>
                                    )}
                                    <span className="text-xs text-content-subtle">
                                        {plan._count?.runs ?? 0} runs
                                    </span>
                                    {permissions.canWrite && plan.status === 'ACTIVE' && (
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="opacity-0 group-hover:opacity-100 transition"
                                            onClick={() => createRun(plan.id)}
                                            disabled={creatingRunFor === plan.id}
                                            id={`run-test-btn-${plan.id}`}
                                        >
                                            {creatingRunFor === plan.id ? '...' : <><AppIcon name="run" size={14} className="inline-block mr-1" /> Run</>}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
