'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Paperclip } from 'lucide-react';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';

const EV_KIND_OPTIONS: ComboboxOption[] = [
    { value: 'FILE_UPLOAD', label: 'Upload File' },
    { value: 'LINK', label: 'URL / Link' },
    { value: 'EVIDENCE', label: 'Existing Evidence Record' },
];

interface EvidenceLink {
    id: string;
    kind: string;
    url: string | null;
    note: string | null;
    fileId: string | null;
    evidenceId: string | null;
    evidence?: { id: string; title: string; type: string } | null;
    createdBy?: { name: string | null; email: string } | null;
    createdAt: string;
}

interface TestRunDetail {
    id: string;
    status: string;
    result: string | null;
    notes: string | null;
    findingSummary: string | null;
    executedAt: string | null;
    controlId: string;
    testPlanId: string;
    testPlan?: { id: string; name: string; controlId: string; frequency: string } | null;
    executedBy?: { name: string | null; email: string } | null;
    createdBy?: { name: string | null; email: string } | null;
    evidence: EvidenceLink[];
    createdAt: string;
}

const RESULT_BADGE: Record<string, string> = {
    PASS: 'badge-success', FAIL: 'badge-danger', INCONCLUSIVE: 'badge-warning',
};

export default function TestRunPage() {
    const params = useParams();
    const router = useRouter();
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions } = useTenantContext();
    const runId = params?.runId as string;

    const [run, setRun] = useState<TestRunDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Complete form
    const [result, setResult] = useState<'PASS' | 'FAIL' | 'INCONCLUSIVE'>('PASS');
    const [notes, setNotes] = useState('');
    const [findingSummary, setFindingSummary] = useState('');
    const [completing, setCompleting] = useState(false);

    // Evidence form
    const [showEvForm, setShowEvForm] = useState(false);
    const [evKind, setEvKind] = useState<'LINK' | 'EVIDENCE' | 'FILE_UPLOAD'>('FILE_UPLOAD');
    const [evUrl, setEvUrl] = useState('');
    const [evNote, setEvNote] = useState('');
    const [evEvidenceId, setEvEvidenceId] = useState('');
    const [evFile, setEvFile] = useState<File | null>(null);
    const [evFileTitle, setEvFileTitle] = useState('');
    const [linkingEv, setLinkingEv] = useState(false);
    const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

    const [retesting, setRetesting] = useState(false);

    const handleRetest = async () => {
        setRetesting(true);
        try {
            const res = await fetch(apiUrl(`/tests/runs/${runId}/retest`), { method: 'POST' });
            if (res.ok) {
                const newRun = await res.json();
                router.push(tenantHref(`/tests/runs/${newRun.id}`));
            }
        } finally {
            setRetesting(false);
        }
    };

    const fetchRun = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/tests/runs/${runId}`));
            if (!res.ok) throw new Error('Run not found');
            setRun(await res.json());
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [apiUrl, runId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchRun(); }, [fetchRun]);

    const completeRun = async () => {
        setCompleting(true);
        try {
            const body: Record<string, unknown> = { result, notes: notes || null };
            if (result === 'FAIL') body.findingSummary = findingSummary || null;
            const res = await fetch(apiUrl(`/tests/runs/${runId}/complete`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                await fetchRun();
            }
        } finally {
            setCompleting(false);
        }
    };

    const linkEvidence = async () => {
        setLinkingEv(true);
        try {
            if (evKind === 'FILE_UPLOAD') {
                // Step 1: Upload file as evidence record
                if (!evFile) return;
                const formData = new FormData();
                formData.append('file', evFile);
                formData.append('title', evFileTitle || evFile.name);
                formData.append('type', 'FILE');
                if (evNote) formData.append('content', evNote);

                const uploadRes = await fetch(apiUrl('/evidence'), {
                    method: 'POST',
                    body: formData,
                });
                if (!uploadRes.ok) {
                    const err = await uploadRes.text();
                    throw new Error(err || 'Upload failed');
                }
                const newEvidence = await uploadRes.json();

                // Step 2: Link the evidence to the test run
                const linkRes = await fetch(apiUrl(`/tests/runs/${runId}/evidence`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind: 'EVIDENCE', evidenceId: newEvidence.id, note: evNote || null }),
                });
                if (!linkRes.ok) throw new Error('Failed to link evidence');
            } else {
                const body: Record<string, unknown> = { kind: evKind, note: evNote || null };
                if (evKind === 'LINK') body.url = evUrl;
                if (evKind === 'EVIDENCE') body.evidenceId = evEvidenceId;
                const res = await fetch(apiUrl(`/tests/runs/${runId}/evidence`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error('Failed to link');
            }

            setShowEvForm(false);
            setEvUrl('');
            setEvNote('');
            setEvEvidenceId('');
            setEvFile(null);
            setEvFileTitle('');
            await fetchRun();
        } finally {
            setLinkingEv(false);
        }
    };

    const unlinkEvidence = async (linkId: string) => {
        setUnlinkingId(linkId);
        try {
            await fetch(apiUrl(`/tests/runs/${runId}/evidence/${linkId}`), { method: 'DELETE' });
            await fetchRun();
        } finally {
            setUnlinkingId(null);
        }
    };

    if (loading) return <div className="p-12 text-center text-content-subtle animate-pulse"><div className="h-6 w-full sm:w-48 bg-bg-elevated rounded mx-auto" /></div>;
    if (error) return <div className="p-12 text-center text-content-error">{error}</div>;
    if (!run) return <div className="p-12 text-center text-content-subtle">Run not found.</div>;

    const isCompleted = run.status === 'COMPLETED';

    // Determine if "Link" button should be disabled
    const canSubmitEvidence = evKind === 'LINK' ? !!evUrl : evKind === 'EVIDENCE' ? !!evEvidenceId : !!evFile;

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs text-content-muted">
                {run.testPlan && (
                    <Link href={tenantHref(`/controls/${run.testPlan.controlId}/tests/${run.testPlanId}`)} className="hover:text-content-emphasis transition">
                        ← {run.testPlan.name}
                    </Link>
                )}
            </div>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold" id="test-run-title">
                        Test Run {run.testPlan ? `— ${run.testPlan.name}` : ''}
                    </h1>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`badge ${run.status === 'COMPLETED' ? 'badge-success' : run.status === 'RUNNING' ? 'badge-info' : 'badge-neutral'}`} id="test-run-status">
                            {run.status}
                        </span>
                        {run.result && (
                            <span className={`badge ${RESULT_BADGE[run.result] || 'badge-neutral'}`} id="test-run-result">
                                {run.result}
                            </span>
                        )}
                        {run.executedAt && (
                            <span className="text-xs text-content-muted">Executed: {formatDate(run.executedAt)}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Complete Form — only if not completed */}
            {!isCompleted && permissions.canWrite && (
                <div className="glass-card p-5 space-y-4 border-l-4 border-[var(--brand-default)]">
                    <h3 className="text-sm font-semibold text-content-emphasis">Complete This Test Run</h3>

                    <div>
                        <label className="text-xs text-content-muted block mb-1">Result *</label>
                        <div className="flex gap-3">
                            {(['PASS', 'FAIL', 'INCONCLUSIVE'] as const).map(r => (
                                <button
                                    key={r}
                                    className={buttonVariants({ variant: result === r ? (r === 'FAIL' ? 'danger' : r === 'PASS' ? 'success' : 'primary') : 'ghost', size: 'sm', className: result === r ? (r === 'PASS' ? 'bg-bg-success-emphasis text-content-emphasis' : r === 'FAIL' ? 'bg-bg-error-emphasis text-content-emphasis' : 'bg-bg-warning-emphasis text-content-emphasis') : '' })}
                                    onClick={() => setResult(r)}
                                    id={`result-btn-${r}`}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-content-muted block mb-1">Notes</label>
                        <textarea
                            className="input w-full h-20"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Observation notes..."
                            id="test-run-notes"
                        />
                    </div>

                    {result === 'FAIL' && (
                        <div className="animate-fadeIn">
                            <label className="text-xs text-content-muted block mb-1">Finding Summary (for auto-created task)</label>
                            <textarea
                                className="input w-full h-16"
                                value={findingSummary}
                                onChange={e => setFindingSummary(e.target.value)}
                                placeholder="Summarize the issue found..."
                                id="test-run-finding-summary"
                            />
                        </div>
                    )}

                    <Button
                        variant="primary"
                        size="sm"
                        onClick={completeRun}
                        disabled={completing}
                        id="complete-test-run-btn"
                    >
                        {completing ? 'Completing...' : `Complete as ${result}`}
                    </Button>
                </div>
            )}

            {/* Completed Info */}
            {isCompleted && (
                <div className="glass-card p-4 space-y-2">
                    {run.notes && (
                        <div>
                            <span className="text-xs text-content-muted">Notes:</span>
                            <p className="text-sm text-content-default whitespace-pre-wrap mt-1">{run.notes}</p>
                        </div>
                    )}
                    {run.findingSummary && (
                        <div>
                            <span className="text-xs text-content-error">Finding Summary:</span>
                            <p className="text-sm text-content-error whitespace-pre-wrap mt-1">{run.findingSummary}</p>
                        </div>
                    )}
                    {run.executedBy && (
                        <div className="text-xs text-content-subtle mt-2">
                            Executed by {run.executedBy.name || run.executedBy.email} at {formatDate(run.executedAt)}
                        </div>
                    )}

                    {/* Retest button for FAIL/INCONCLUSIVE */}
                    {permissions.canWrite && (run.result === 'FAIL' || run.result === 'INCONCLUSIVE') && (
                        <div className="mt-3 pt-3 border-t border-border-default/50">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleRetest}
                                disabled={retesting}
                                id="retest-btn"
                            >
                                {retesting ? 'Creating...' : 'Retest'}
                            </Button>
                            <span className="text-xs text-content-subtle ml-2">Create a new run for this test plan</span>
                        </div>
                    )}
                </div>
            )}

            {/* Evidence Section */}
            <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content-default">Evidence ({run.evidence?.length ?? 0})</h3>
                    {permissions.canWrite && (
                        <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => setShowEvForm(!showEvForm)}
                            id="link-evidence-btn"
                        >
                            {showEvForm ? 'Cancel' : '+ Link Evidence'}
                        </Button>
                    )}
                </div>

                {showEvForm && (
                    <div className="space-y-3 mb-4 p-3 rounded bg-bg-default/50 animate-fadeIn">
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Evidence Type</label>
                            <Combobox
                                hideSearch
                                id="evidence-kind-select"
                                selected={EV_KIND_OPTIONS.find(o => o.value === evKind) ?? null}
                                setSelected={(opt) => setEvKind((opt?.value ?? 'FILE_UPLOAD') as 'LINK' | 'EVIDENCE' | 'FILE_UPLOAD')}
                                options={EV_KIND_OPTIONS}
                                matchTriggerWidth
                            />
                        </div>
                        {evKind === 'FILE_UPLOAD' && (
                            <>
                                <div>
                                    <label className="text-xs text-content-muted block mb-1">File</label>
                                    <label className="flex flex-col items-center justify-center w-full p-4 border-2 border-dashed border-border-emphasis rounded-lg cursor-pointer hover:border-[var(--brand-default)]/50 transition-colors bg-bg-page/30">
                                        <input
                                            type="file"
                                            className="hidden"
                                            onChange={e => {
                                                const f = e.target.files?.[0] || null;
                                                setEvFile(f);
                                                if (f && !evFileTitle) setEvFileTitle(f.name);
                                            }}
                                            id="evidence-file-input"
                                        />
                                        {evFile ? (
                                            <div className="text-sm text-content-emphasis flex items-center gap-2">
                                                <Paperclip className="w-4 h-4 text-[var(--brand-default)]" aria-hidden="true" />
                                                <span>{evFile.name}</span>
                                                <span className="text-xs text-content-subtle">({(evFile.size / 1024).toFixed(1)} KB)</span>
                                            </div>
                                        ) : (
                                            <div className="text-center">
                                                <p className="text-sm text-content-muted">Click to select a file</p>
                                                <p className="text-xs text-content-subtle mt-1">PDF, images, documents, logs, etc.</p>
                                            </div>
                                        )}
                                    </label>
                                </div>
                                <div>
                                    <label className="text-xs text-content-muted block mb-1">Title</label>
                                    <input className="input w-full" value={evFileTitle} onChange={e => setEvFileTitle(e.target.value)} placeholder="Evidence title..." id="evidence-file-title-input" />
                                </div>
                            </>
                        )}
                        {evKind === 'LINK' && (
                            <div>
                                <label className="text-xs text-content-muted block mb-1">URL</label>
                                <input className="input w-full" value={evUrl} onChange={e => setEvUrl(e.target.value)} placeholder="https://..." id="evidence-url-input" />
                            </div>
                        )}
                        {evKind === 'EVIDENCE' && (
                            <div>
                                <label className="text-xs text-content-muted block mb-1">Evidence ID</label>
                                <input className="input w-full" value={evEvidenceId} onChange={e => setEvEvidenceId(e.target.value)} placeholder="Evidence record ID" id="evidence-id-input" />
                            </div>
                        )}
                        <div>
                            <label className="text-xs text-content-muted block mb-1">Note</label>
                            <input className="input w-full" value={evNote} onChange={e => setEvNote(e.target.value)} placeholder="Optional note..." id="evidence-note-input" />
                        </div>
                        <Button
                            variant="primary"
                            size="xs"
                            onClick={linkEvidence}
                            disabled={linkingEv || !canSubmitEvidence}
                            id="save-evidence-link-btn"
                        >
                            {linkingEv ? (evKind === 'FILE_UPLOAD' ? 'Uploading...' : 'Linking...') : (evKind === 'FILE_UPLOAD' ? 'Upload & Link' : 'Link')}
                        </Button>
                    </div>
                )}

                {run.evidence.length === 0 ? (
                    <p className="text-sm text-content-subtle">No evidence linked yet.</p>
                ) : (
                    <div className="divide-y divide-border-default/50">
                        {run.evidence.map(ev => (
                            <div key={ev.id} className="flex items-center justify-between py-2 group">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="badge badge-xs badge-neutral">{ev.kind}</span>
                                        {ev.evidence && (
                                            <span className="text-sm text-content-default">{ev.evidence.title}</span>
                                        )}
                                        {ev.url && (
                                            <a href={ev.url} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--brand-default)] hover:underline truncate">
                                                {ev.url}
                                            </a>
                                        )}
                                    </div>
                                    {ev.note && <p className="text-xs text-content-subtle mt-0.5">{ev.note}</p>}
                                    <p className="text-xs text-content-subtle mt-0.5">
                                        {ev.createdBy?.name || ev.createdBy?.email} • {formatDate(ev.createdAt)}
                                    </p>
                                </div>
                                {permissions.canWrite && (
                                    <Tooltip content="Unlink evidence from this test">
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="text-content-error opacity-0 group-hover:opacity-100 transition"
                                            onClick={() => unlinkEvidence(ev.id)}
                                            disabled={unlinkingId === ev.id}
                                            aria-label="Unlink evidence"
                                        >
                                            {unlinkingId === ev.id ? '...' : <span aria-hidden="true">×</span>}
                                        </Button>
                                    </Tooltip>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Meta */}
            <div className="text-xs text-content-subtle">
                Created {formatDate(run.createdAt)} by {run.createdBy?.name || run.createdBy?.email || 'Unknown'}
            </div>
        </div>
    );
}
