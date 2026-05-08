'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { TestPlanScheduleSection } from '@/components/TestPlanScheduleSection';

interface TestPlanDetail {
    id: string;
    name: string;
    description: string | null;
    method: string;
    frequency: string;
    status: string;
    nextDueAt: string | null;
    // Epic G-2 — automation scheduling fields. Returned by the
    // existing GET /tests/plans/:id; used by TestPlanScheduleSection
    // to render the cadence picker + next-run indicator.
    automationType: 'MANUAL' | 'SCRIPT' | 'INTEGRATION';
    schedule: string | null;
    scheduleTimezone: string | null;
    nextRunAt: string | null;
    controlId: string;
    owner?: { id: string; name: string | null; email: string } | null;
    createdBy?: { id: string; name: string | null; email: string } | null;
    steps: Array<{ id: string; sortOrder: number; instruction: string; expectedOutput: string | null }>;
    runs: Array<{
        id: string;
        status: string;
        result: string | null;
        executedAt: string | null;
        notes: string | null;
        executedBy?: { name: string | null; email: string } | null;
        _count?: { evidence: number };
    }>;
    _count?: { runs: number; steps: number };
    createdAt: string;
}

const FREQ_LABELS: Record<string, string> = {
    AD_HOC: 'Ad Hoc', DAILY: 'Daily', WEEKLY: 'Weekly',
    MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually',
};
const RESULT_BADGE: Record<string, string> = {
    PASS: 'badge-success', FAIL: 'badge-danger', INCONCLUSIVE: 'badge-warning',
};
const RUN_STATUS_BADGE: Record<string, string> = {
    PLANNED: 'badge-neutral', RUNNING: 'badge-info', COMPLETED: 'badge-success',
};
const FREQ_CB_OPTIONS: ComboboxOption[] = Object.entries(FREQ_LABELS).map(([v, l]) => ({ value: v, label: l }));
const METHOD_OPTIONS: ComboboxOption[] = [{ value: 'MANUAL', label: 'Manual' }, { value: 'AUTOMATED', label: 'Automated' }];
const PLAN_STATUS_OPTIONS: ComboboxOption[] = [{ value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Paused' }];

export default function TestPlanDetailPage() {
    const params = useParams();
    const router = useRouter();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();
    const controlId = params?.controlId as string;
    const planId = params?.planId as string;

    const [plan, setPlan] = useState<TestPlanDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Edit state
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editFreq, setEditFreq] = useState('');
    const [editMethod, setEditMethod] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [saving, setSaving] = useState(false);

    const [creatingRun, setCreatingRun] = useState(false);

    const fetchPlan = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/tests/plans/${planId}`));
            if (!res.ok) throw new Error('Plan not found');
            const data = await res.json();
            setPlan(data);
            setEditName(data.name);
            setEditDesc(data.description || '');
            setEditFreq(data.frequency);
            setEditMethod(data.method);
            setEditStatus(data.status);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [apiUrl, planId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchPlan(); }, [fetchPlan]);

    const savePlan = async () => {
        setSaving(true);
        try {
            const res = await fetch(apiUrl(`/tests/plans/${planId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editName,
                    description: editDesc || null,
                    frequency: editFreq,
                    method: editMethod,
                    status: editStatus,
                }),
            });
            if (res.ok) {
                setEditing(false);
                await fetchPlan();
            }
        } finally {
            setSaving(false);
        }
    };

    const createRun = async () => {
        setCreatingRun(true);
        try {
            const res = await fetch(apiUrl(`/tests/plans/${planId}/runs`), { method: 'POST' });
            if (res.ok) {
                const run = await res.json();
                router.push(tenantHref(`/tests/runs/${run.id}`));
            }
        } finally {
            setCreatingRun(false);
        }
    };

    if (loading) return <div className="p-12 text-center text-content-subtle animate-pulse">Loading test plan...</div>;
    if (error) return <div className="p-12 text-center text-content-error">{error}</div>;
    if (!plan) return <div className="p-12 text-center text-content-subtle">Plan not found.</div>;

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Breadcrumb */}
            <div>
                <Link href={tenantHref(`/controls/${controlId}`)} className="text-content-muted text-xs hover:text-content-emphasis transition">
                    ← Back to Control
                </Link>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" id="test-plan-title">{plan.name}</h1>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`badge ${plan.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`} id="test-plan-status">
                            {plan.status}
                        </span>
                        <span className="text-xs text-content-subtle">{FREQ_LABELS[plan.frequency] || plan.frequency}</span>
                        <span className="text-xs text-content-subtle">•</span>
                        <span className="text-xs text-content-subtle">{plan.method}</span>
                        {plan.nextDueAt && (
                            <>
                                <span className="text-xs text-content-subtle">•</span>
                                <span className={`text-xs ${new Date(plan.nextDueAt) < new Date() ? 'text-content-error font-semibold' : 'text-content-muted'}`}>
                                    Due: {formatDate(plan.nextDueAt)}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                {permissions.canWrite && (
                    <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(!editing)} id="edit-test-plan-btn">
                            {editing ? 'Cancel' : 'Edit'}
                        </Button>
                        {plan.status === 'ACTIVE' && (
                            <Button variant="primary" size="sm" onClick={createRun} disabled={creatingRun} id="create-test-run-btn">
                                {creatingRun ? '...' : 'Run Test Now'}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* Edit Form */}
            {editing && permissions.canWrite && (
                <div className="glass-card p-4 space-y-3 animate-fadeIn">
                    <div>
                        <label className="text-xs text-content-muted block mb-1">Name</label>
                        <input className="input w-full" value={editName} onChange={e => setEditName(e.target.value)} id="edit-plan-name" />
                    </div>
                    <div>
                        <label className="text-xs text-content-muted block mb-1">Description</label>
                        <textarea className="input w-full h-20" value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Frequency</label>
                            <Combobox hideSearch selected={FREQ_CB_OPTIONS.find(o => o.value === editFreq) ?? null} setSelected={(opt) => setEditFreq(opt?.value ?? editFreq)} options={FREQ_CB_OPTIONS} matchTriggerWidth />
                        </div>
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Method</label>
                            <Combobox hideSearch selected={METHOD_OPTIONS.find(o => o.value === editMethod) ?? null} setSelected={(opt) => setEditMethod(opt?.value ?? editMethod)} options={METHOD_OPTIONS} matchTriggerWidth />
                        </div>
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Status</label>
                            <Combobox hideSearch id="edit-plan-status" selected={PLAN_STATUS_OPTIONS.find(o => o.value === editStatus) ?? null} setSelected={(opt) => setEditStatus(opt?.value ?? editStatus)} options={PLAN_STATUS_OPTIONS} matchTriggerWidth />
                        </div>
                    </div>
                    <Button variant="primary" size="sm" onClick={savePlan} disabled={saving} id="save-plan-changes-btn">
                        {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            )}

            {/* Epic G-2 — schedule picker + next-run indicator */}
            <TestPlanScheduleSection
                planId={plan.id}
                initialAutomationType={plan.automationType}
                initialSchedule={plan.schedule}
                initialScheduleTimezone={plan.scheduleTimezone}
                initialNextRunAt={plan.nextRunAt}
                canEdit={permissions.canWrite}
                onSaved={fetchPlan}
            />

            {/* Info Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-4 text-center">
                    <div className="text-2xl font-bold text-[var(--brand-default)]">{plan._count?.runs ?? 0}</div>
                    <div className="text-xs text-content-muted mt-1">Total Runs</div>
                </div>
                <div className="glass-card p-4 text-center">
                    <div className="text-2xl font-bold text-content-success">
                        {plan.runs?.filter(r => r.result === 'PASS').length ?? 0}
                    </div>
                    <div className="text-xs text-content-muted mt-1">Passed</div>
                </div>
                <div className="glass-card p-4 text-center">
                    <div className="text-2xl font-bold text-content-error">
                        {plan.runs?.filter(r => r.result === 'FAIL').length ?? 0}
                    </div>
                    <div className="text-xs text-content-muted mt-1">Failed</div>
                </div>
                <div className="glass-card p-4 text-center">
                    <div className="text-2xl font-bold text-content-default">{plan._count?.steps ?? 0}</div>
                    <div className="text-xs text-content-muted mt-1">Steps</div>
                </div>
            </div>

            {/* Description */}
            {plan.description && (
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold text-content-default mb-2">Description</h3>
                    <p className="text-sm text-content-muted whitespace-pre-wrap">{plan.description}</p>
                </div>
            )}

            {/* Steps */}
            {plan.steps.length > 0 && (
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold text-content-default mb-3">Test Procedure</h3>
                    <ol className="space-y-2">
                        {plan.steps.map((step, i) => (
                            <li key={step.id} className="flex gap-3 text-sm">
                                <span className="w-6 h-6 rounded-full bg-[var(--brand-subtle)] text-[var(--brand-default)] text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                                    {i + 1}
                                </span>
                                <div>
                                    <p className="text-content-default">{step.instruction}</p>
                                    {step.expectedOutput && (
                                        <p className="text-xs text-content-subtle mt-0.5">Expected: {step.expectedOutput}</p>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {/* Runs History */}
            <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content-default">Test Run History</h3>
                    {permissions.canWrite && plan.status === 'ACTIVE' && (
                        <Button variant="primary" size="xs" onClick={createRun} disabled={creatingRun}>
                            {creatingRun ? '...' : 'New Run'}
                        </Button>
                    )}
                </div>

                {plan.runs.length === 0 ? (
                    <p className="text-sm text-content-subtle">No test runs yet.</p>
                ) : (
                    <div className="divide-y divide-border-default/50">
                        {plan.runs.map(run => (
                            <Link
                                key={run.id}
                                href={tenantHref(`/tests/runs/${run.id}`)}
                                className="flex items-center justify-between py-2.5 hover:bg-bg-default/30 px-2 rounded transition group"
                                id={`test-run-link-${run.id}`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className={`badge badge-xs ${RUN_STATUS_BADGE[run.status] || 'badge-neutral'}`}>
                                        {run.status}
                                    </span>
                                    {run.result && (
                                        <span className={`badge badge-xs ${RESULT_BADGE[run.result] || 'badge-neutral'}`}>
                                            {run.result}
                                        </span>
                                    )}
                                    <span className="text-xs text-content-muted">
                                        {run.executedAt ? formatDate(run.executedAt) : 'Not executed'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {run.executedBy && (
                                        <span className="text-xs text-content-subtle">
                                            {run.executedBy.name || run.executedBy.email}
                                        </span>
                                    )}
                                    {run._count?.evidence ? (
                                        <span className="text-xs text-content-subtle">{run._count.evidence} evidence</span>
                                    ) : null}
                                    <span className="text-xs text-content-subtle opacity-0 group-hover:opacity-100">→</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            {/* Meta */}
            <div className="text-xs text-content-subtle">
                Created {formatDate(plan.createdAt)} by {plan.createdBy?.name || plan.createdBy?.email || 'Unknown'}
                {plan.owner && <> • Owner: {plan.owner.name || plan.owner.email}</>}
            </div>
        </div>
    );
}
