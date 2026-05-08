'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { formatDate } from '@/lib/format-date';
import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useTenantApiUrl, useTenantHref, useTenantContext } from '@/lib/tenant-context-provider';
import { Button } from '@/components/ui/button';
import { SkeletonDetailPage } from '@/components/ui/skeleton';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { useToastWithUndo } from '@/components/ui/hooks';
import { normaliseHref } from '@/lib/security/safe-url';

const STATUS_BADGE: Record<string, string> = {
    ACTIVE: 'badge-success', ONBOARDING: 'badge-info', OFFBOARDING: 'badge-warning', OFFBOARDED: 'badge-neutral',
};
const CRIT_BADGE: Record<string, string> = { LOW: 'badge-neutral', MEDIUM: 'badge-warning', HIGH: 'badge-danger', CRITICAL: 'badge-danger' };
const DOC_TYPE_LABELS: Record<string, string> = {
    CONTRACT: 'Contract', SOC2: 'SOC 2', ISO_CERT: 'ISO 27001', DPA: 'DPA',
    SECURITY_POLICY: 'Security Policy', PEN_TEST: 'Pen Test Report', OTHER: 'Other',
};
const DOC_TYPES = Object.keys(DOC_TYPE_LABELS);
const ASSESSMENT_STATUS_BADGE: Record<string, string> = {
    DRAFT: 'badge-neutral', IN_REVIEW: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger',
};
const VENDOR_STATUS_OPTIONS: ComboboxOption[] = ['ACTIVE', 'ONBOARDING', 'OFFBOARDING', 'OFFBOARDED'].map(s => ({ value: s, label: s }));
const VENDOR_CRIT_OPTIONS: ComboboxOption[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(c => ({ value: c, label: c }));
const DOC_TYPE_CB_OPTIONS: ComboboxOption[] = DOC_TYPES.map(t => ({ value: t, label: DOC_TYPE_LABELS[t] || t }));
const VENDOR_LINK_TYPE_OPTIONS: ComboboxOption[] = [
    { value: 'ASSET', label: 'Asset' }, { value: 'RISK', label: 'Risk' },
    { value: 'ISSUE', label: 'Issue' }, { value: 'CONTROL', label: 'Control' },
];
const VENDOR_LINK_RELATION_OPTIONS: ComboboxOption[] = [
    { value: 'RELATED', label: 'Related' }, { value: 'USES', label: 'Uses' },
    { value: 'MITIGATES', label: 'Mitigates' }, { value: 'STORES_DATA_FOR', label: 'Stores Data' },
];

type Tab = 'overview' | 'documents' | 'assessments' | 'links' | 'bundles' | 'subprocessors';

export default function VendorDetailPage(props: { params: Promise<{ tenantSlug: string; vendorId: string }> }) {
    const params = use(props.params);
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();
    const { permissions, role } = useTenantContext();
    const canWrite = permissions?.canWrite;
    const triggerUndoToast = useToastWithUndo();

    const [vendor, setVendor] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>('overview');
    const [docs, setDocs] = useState<any[]>([]);
    const [assessments, setAssessments] = useState<any[]>([]);
    const [templates, setTemplates] = useState<any[]>([]);
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState<any>({});

    // Doc form
    const [showDocForm, setShowDocForm] = useState(false);
    const [docForm, setDocForm] = useState({ type: 'CONTRACT', title: '', externalUrl: '', notes: '' });
    // Assessment start
    const [showStartAssessment, setShowStartAssessment] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    // Enrichment
    const [enriching, setEnriching] = useState(false);
    // Links
    const [links, setLinks] = useState<any[]>([]);
    const [showLinkForm, setShowLinkForm] = useState(false);
    const [linkForm, setLinkForm] = useState({ entityType: 'ASSET', entityId: '', relation: 'RELATED' });
    // Bundles
    const [bundles, setBundles] = useState<any[]>([]);
    const [bundleName, setBundleName] = useState('');
    // Subprocessors
    const [subs, setSubs] = useState<any[]>([]);
    const [subForm, setSubForm] = useState({ subprocessorVendorId: '', purpose: '' });

    const fetchVendor = useCallback(async () => {
        setLoading(true);
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}`));
        if (res.ok) {
            const v = await res.json();
            setVendor(v);
            setEditForm({ name: v.name, legalName: v.legalName || '', websiteUrl: v.websiteUrl || '', domain: v.domain || '', country: v.country || '', description: v.description || '', criticality: v.criticality, status: v.status });
        }
        setLoading(false);
    }, [apiUrl, params.vendorId]);

    const fetchDocs = useCallback(async () => {
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/documents`));
        if (res.ok) setDocs(await res.json());
    }, [apiUrl, params.vendorId]);

    const fetchAssessments = useCallback(async () => {
        const res = await fetch(apiUrl(`/vendors/questionnaires/templates`));
        if (res.ok) setTemplates(await res.json());
        // We get assessments from vendor detail, but need a separate list
        // For now, we'll use a simple approach
        const aRes = await fetch(apiUrl(`/vendors/${params.vendorId}`));
        if (aRes.ok) {
            const v = await aRes.json();
            setAssessments(v.assessments || []);
        }
    }, [apiUrl, params.vendorId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchVendor(); }, [fetchVendor]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { if (tab === 'documents') fetchDocs(); }, [tab, fetchDocs]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { if (tab === 'assessments') fetchAssessments(); }, [tab, fetchAssessments]);

    const fetchLinks = useCallback(async () => {
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/links`));
        if (res.ok) setLinks(await res.json());
    }, [apiUrl, params.vendorId]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { if (tab === 'links') fetchLinks(); }, [tab, fetchLinks]);

    const fetchBundles = useCallback(async () => {
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/bundles`));
        if (res.ok) setBundles(await res.json());
    }, [apiUrl, params.vendorId]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { if (tab === 'bundles') fetchBundles(); }, [tab, fetchBundles]);

    const fetchSubs = useCallback(async () => {
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/subprocessors`));
        if (res.ok) setSubs(await res.json());
    }, [apiUrl, params.vendorId]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { if (tab === 'subprocessors') fetchSubs(); }, [tab, fetchSubs]);

    const saveEdit = async () => {
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}`), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm),
        });
        if (res.ok) { setVendor(await res.json()); setEditing(false); }
    };

    const addDoc = async (e: React.FormEvent) => {
        e.preventDefault();
        const body: any = { type: docForm.type };
        if (docForm.title) body.title = docForm.title;
        if (docForm.externalUrl) body.externalUrl = docForm.externalUrl;
        if (docForm.notes) body.notes = docForm.notes;
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/documents`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) { 
            const newDoc = await res.json();
            setDocs(prev => [newDoc, ...prev]);
            setShowDocForm(false); 
            setDocForm({ type: 'CONTRACT', title: '', externalUrl: '', notes: '' }); 
            // Also call fetchDocs just in case we need uploadedBy info, but state already has the doc
            fetchDocs(); 
        }
    };

    // Epic 67 — delayed-commit doc removal. The 5-second undo window
    // replaces the previous `confirm()` modal: the user gets a more
    // forgiving "you have time to take it back" affordance instead of
    // a blocking double-click. Snapshot + optimistic-filter pattern,
    // identical shape to tasks/removeLink and the other rolled-out
    // sites — see docs/destructive-actions.md.
    const removeDoc = (docId: string) => {
        const previous = docs;
        setDocs(prev => prev.filter(d => d.id !== docId));
        triggerUndoToast({
            message: 'Document removed',
            undoMessage: 'Undo',
            action: async () => {
                const res = await fetch(
                    apiUrl(`/vendors/${params.vendorId}/documents/${docId}`),
                    { method: 'DELETE' },
                );
                if (!res.ok) throw new Error('Remove document failed');
            },
            undoAction: () => setDocs(previous),
            onError: () => setDocs(previous),
        });
    };

    const startAssessment = async () => {
        if (!selectedTemplate) return;
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/assessments/start`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateKey: selectedTemplate }),
        });
        if (res.ok) {
            const assessment = await res.json();
            window.location.href = tenantHref(`/vendors/${params.vendorId}/assessment/${assessment.id}`);
        }
    };

    const handleEnrich = async () => {
        setEnriching(true);
        const res = await fetch(apiUrl(`/vendors/${params.vendorId}/enrich`), { method: 'POST' });
        if (res.ok) { setVendor(await res.json()); }
        setEnriching(false);
    };

    if (loading) return <SkeletonDetailPage />;
    if (!vendor) return <div className="text-content-error py-8 text-center">Vendor not found</div>;

    const fmtDate = (d: string | null) => d ? formatDate(d) : '—';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href={tenantHref('/vendors')} className="text-content-muted hover:text-content-emphasis">← Back</Link>
                    <h1 className="text-2xl font-bold" id="vendor-detail-name">{vendor.name}</h1>
                    <span className={`badge ${STATUS_BADGE[vendor.status]}`}>{vendor.status}</span>
                    <span className={`badge ${CRIT_BADGE[vendor.criticality]}`}>{vendor.criticality}</span>
                </div>
                <div className="flex gap-2">
                    {canWrite && (vendor.domain || vendor.websiteUrl) && (
                        <Button variant="secondary" onClick={handleEnrich} disabled={enriching} id="enrich-vendor-btn">
                            {enriching ? 'Enriching…' : 'Auto-fill'}
                        </Button>
                    )}
                    {canWrite && !editing && (
                        <Button variant="secondary" onClick={() => setEditing(true)} id="edit-vendor-btn">Edit</Button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border-default">
                {(['overview', 'documents', 'assessments', 'links', 'bundles', 'subprocessors'] as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`px-4 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-border-info text-content-emphasis' : 'text-content-muted hover:text-content-emphasis'}`}
                        id={`tab-${t}`}>
                        {t} {t === 'documents' ? `(${vendor._count?.documents || 0})` : t === 'assessments' ? `(${vendor._count?.assessments || 0})` : ''}
                    </button>
                ))}
            </div>

            {/* OVERVIEW */}
            {tab === 'overview' && !editing && (
                <div className="card p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><span className="text-content-muted">Legal Name:</span> <span className="ml-2">{vendor.legalName || '—'}</span></div>
                        <div><span className="text-content-muted">Domain:</span> <span className="ml-2">{vendor.domain || '—'}</span></div>
                        <div><span className="text-content-muted">Website:</span> <span className="ml-2">{normaliseHref(vendor.websiteUrl) ? <a href={normaliseHref(vendor.websiteUrl)!} target="_blank" rel="noopener noreferrer" className="text-content-info underline">{vendor.websiteUrl}</a> : '—'}</span></div>
                        <div><span className="text-content-muted">Country:</span> <span className="ml-2">{vendor.country || '—'}</span></div>
                        <div><span className="text-content-muted">Owner:</span> <span className="ml-2">{vendor.owner?.name || '—'}</span></div>
                        <div><span className="text-content-muted">Data Access:</span> <span className="ml-2">{vendor.dataAccess || '—'}</span></div>
                        <div><span className="text-content-muted">Sub-processor:</span> <span className="ml-2">{vendor.isSubprocessor ? 'Yes' : 'No'}</span></div>
                        <div><span className="text-content-muted">Inherent Risk:</span> <span className="ml-2">{vendor.inherentRisk ? <span className={`badge ${CRIT_BADGE[vendor.inherentRisk]}`}>{vendor.inherentRisk}</span> : '—'}</span></div>
                        <div><span className="text-content-muted">Next Review:</span> <span className="ml-2">{fmtDate(vendor.nextReviewAt)}</span></div>
                        <div><span className="text-content-muted">Contract Renewal:</span> <span className="ml-2">{fmtDate(vendor.contractRenewalAt)}</span></div>
                    </div>
                    {/* Enrichment Fields */}
                    {(vendor.privacyPolicyUrl || vendor.securityPageUrl || vendor.certificationsJson) && (
                        <div className="border-t border-border-default pt-3 mt-3 space-y-2">
                            <h3 className="text-sm font-semibold text-content-default">Enrichment Data</h3>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                {normaliseHref(vendor.privacyPolicyUrl) && <div><span className="text-content-muted">Privacy Policy:</span> <a href={normaliseHref(vendor.privacyPolicyUrl)!} target="_blank" rel="noopener noreferrer" className="text-content-info underline ml-1" id="enrichment-privacy">View ↗</a></div>}
                                {normaliseHref(vendor.securityPageUrl) && <div><span className="text-content-muted">Security Page:</span> <a href={normaliseHref(vendor.securityPageUrl)!} target="_blank" rel="noopener noreferrer" className="text-content-info underline ml-1" id="enrichment-security">View ↗</a></div>}
                                {vendor.certificationsJson && Array.isArray(vendor.certificationsJson) && (
                                    <div className="col-span-2"><span className="text-content-muted">Certifications:</span> {(vendor.certificationsJson as string[]).map((c: string) => <span key={c} className="badge badge-info ml-1">{c}</span>)}</div>
                                )}
                            </div>
                            {vendor.enrichmentLastRunAt && <p className="text-xs text-content-subtle">Last enriched: {fmtDate(vendor.enrichmentLastRunAt)} ({vendor.enrichmentStatus})</p>}
                        </div>
                    )}
                    {vendor.description && <div className="text-sm text-content-default border-t border-border-default pt-3 mt-3">{vendor.description}</div>}
                </div>
            )}

            {/* EDIT FORM */}
            {tab === 'overview' && editing && canWrite && (
                <div className="card p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-content-muted mb-1">Name</label>
                            <input className="input w-full" value={editForm.name} onChange={e => setEditForm((p: any) => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div>
                            <label className="block text-sm text-content-muted mb-1">Legal Name</label>
                            <input className="input w-full" value={editForm.legalName} onChange={e => setEditForm((p: any) => ({ ...p, legalName: e.target.value }))} />
                        </div>
                        <div>
                            <label className="block text-sm text-content-muted mb-1">Status</label>
                            <Combobox hideSearch selected={VENDOR_STATUS_OPTIONS.find(o => o.value === editForm.status) ?? null} setSelected={(opt) => setEditForm((p: any) => ({ ...p, status: opt?.value ?? p.status }))} options={VENDOR_STATUS_OPTIONS} matchTriggerWidth />
                        </div>
                        <div>
                            <label className="block text-sm text-content-muted mb-1">Criticality</label>
                            <Combobox hideSearch selected={VENDOR_CRIT_OPTIONS.find(o => o.value === editForm.criticality) ?? null} setSelected={(opt) => setEditForm((p: any) => ({ ...p, criticality: opt?.value ?? p.criticality }))} options={VENDOR_CRIT_OPTIONS} matchTriggerWidth />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm text-content-muted mb-1">Description</label>
                        <textarea className="input w-full h-20" value={editForm.description} onChange={e => setEditForm((p: any) => ({ ...p, description: e.target.value }))} />
                    </div>
                    <div className="flex gap-3">
                        <Button variant="primary" onClick={saveEdit} id="save-vendor-btn">Save</Button>
                        <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                    </div>
                </div>
            )}

            {/* DOCUMENTS */}
            {tab === 'documents' && (
                <div className="space-y-4">
                    {canWrite && (
                        <div className="flex justify-end">
                            <Button variant="primary" onClick={() => setShowDocForm(!showDocForm)} id="add-doc-btn">
                                {showDocForm ? 'Cancel' : '+ Add Document'}
                            </Button>
                        </div>
                    )}
                    {showDocForm && canWrite && (
                        <form onSubmit={addDoc} className="card p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm text-content-muted mb-1">Type</label>
                                    <Combobox hideSearch id="doc-type-select" selected={DOC_TYPE_CB_OPTIONS.find(o => o.value === docForm.type) ?? null} setSelected={(opt) => setDocForm(p => ({ ...p, type: opt?.value ?? p.type }))} options={DOC_TYPE_CB_OPTIONS} matchTriggerWidth />
                                </div>
                                <div>
                                    <label className="block text-sm text-content-muted mb-1">Title</label>
                                    <input className="input w-full" value={docForm.title} onChange={e => setDocForm(p => ({ ...p, title: e.target.value }))} id="doc-title-input" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm text-content-muted mb-1">External URL</label>
                                <input className="input w-full" type="url" value={docForm.externalUrl} onChange={e => setDocForm(p => ({ ...p, externalUrl: e.target.value }))} placeholder="https://..." id="doc-url-input" />
                            </div>
                            <div>
                                <label className="block text-sm text-content-muted mb-1">Notes</label>
                                <input className="input w-full" value={docForm.notes} onChange={e => setDocForm(p => ({ ...p, notes: e.target.value }))} id="doc-notes-input" />
                            </div>
                            <Button type="submit" variant="primary" id="submit-doc-btn">Add Document</Button>
                        </form>
                    )}
                    <div className="card overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border-default text-left text-xs uppercase text-content-muted">
                                    <th className="p-3">Type</th>
                                    <th className="p-3">Title</th>
                                    <th className="p-3">Valid To</th>
                                    <th className="p-3">Uploaded By</th>
                                    <th className="p-3">Link</th>
                                    {canWrite && <th className="p-3"></th>}
                                </tr>
                            </thead>
                            <tbody>
                                {docs.map(d => (
                                    <tr key={d.id} className="border-b border-border-subtle">
                                        <td className="p-3"><span className="badge badge-info">{DOC_TYPE_LABELS[d.type] || d.type}</span></td>
                                        <td className="p-3">{d.title || '—'}</td>
                                        <td className="p-3">{d.validTo ? formatDate(d.validTo) : '—'}</td>
                                        <td className="p-3 text-content-muted">{d.uploadedBy?.name || '—'}</td>
                                        <td className="p-3">
                                            {normaliseHref(d.externalUrl) && <a href={normaliseHref(d.externalUrl)!} target="_blank" rel="noopener noreferrer" className="text-content-info underline text-xs">Open ↗</a>}
                                        </td>
                                        {canWrite && <td className="p-3"><button className="text-content-error text-xs hover:underline" onClick={() => removeDoc(d.id)}>Remove</button></td>}
                                    </tr>
                                ))}
                                {docs.length === 0 && <tr><td colSpan={6} className="text-center text-content-subtle py-8">No documents</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ASSESSMENTS */}
            {tab === 'assessments' && (
                <div className="space-y-4">
                    {canWrite && (
                        <div className="flex items-center gap-3 justify-end">
                            {!showStartAssessment ? (
                                <Button variant="primary" onClick={() => setShowStartAssessment(true)} id="start-assessment-btn">
                                    + Start Assessment
                                </Button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Combobox
                                        id="template-select"
                                        selected={templates.map((t: any) => ({ value: t.key, label: `${t.name} (${t._count?.questions || 0} Q)` })).find((o: ComboboxOption) => o.value === selectedTemplate) ?? null}
                                        setSelected={(opt) => setSelectedTemplate(opt?.value ?? '')}
                                        options={templates.map((t: any) => ({ value: t.key, label: `${t.name} (${t._count?.questions || 0} Q)` }))}
                                        placeholder="Select template…"
                                        matchTriggerWidth
                                        buttonProps={{ className: 'w-48' }}
                                    />
                                    <Button variant="primary" onClick={startAssessment} disabled={!selectedTemplate} id="confirm-start-assessment">Start</Button>
                                    <Button variant="secondary" onClick={() => setShowStartAssessment(false)}>Cancel</Button>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="card overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border-default text-left text-xs uppercase text-content-muted">
                                    <th className="p-3">Template</th>
                                    <th className="p-3">Status</th>
                                    <th className="p-3">Score</th>
                                    <th className="p-3">Risk Rating</th>
                                    <th className="p-3">Started</th>
                                    <th className="p-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assessments.map((a: any) => (
                                    <tr key={a.id} className="border-b border-border-subtle">
                                        <td className="p-3">{a.template?.name || '—'}</td>
                                        <td className="p-3"><span className={`badge ${ASSESSMENT_STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                                        <td className="p-3">{a.score != null ? a.score.toFixed(1) : '—'}</td>
                                        <td className="p-3">{a.riskRating ? <span className={`badge ${CRIT_BADGE[a.riskRating]}`}>{a.riskRating}</span> : '—'}</td>
                                        <td className="p-3 text-content-muted">{formatDate(a.startedAt)}</td>
                                        <td className="p-3">
                                            <Link href={tenantHref(`/vendors/${params.vendorId}/assessment/${a.id}`)} className="text-content-info hover:underline text-xs" id={`open-assessment-${a.id}`}>
                                                Open →
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                                {assessments.length === 0 && <tr><td colSpan={6} className="text-center text-content-subtle py-8">No assessments</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* LINKS / TRACEABILITY */}
            {tab === 'links' && (
                <div className="space-y-4">
                    {canWrite && (
                        <div className="flex justify-end">
                            <Button variant="primary" onClick={() => setShowLinkForm(!showLinkForm)} id="add-link-btn">
                                {showLinkForm ? 'Cancel' : '+ Link Entity'}
                            </Button>
                        </div>
                    )}
                    {showLinkForm && canWrite && (
                        <div className="card p-4 flex items-end gap-3">
                            <div>
                                <label className="block text-sm text-content-muted mb-1">Type</label>
                                <Combobox hideSearch id="link-type" selected={VENDOR_LINK_TYPE_OPTIONS.find(o => o.value === linkForm.entityType) ?? null} setSelected={(opt) => setLinkForm(p => ({ ...p, entityType: opt?.value ?? p.entityType }))} options={VENDOR_LINK_TYPE_OPTIONS} matchTriggerWidth />
                            </div>
                            <div>
                                <label className="block text-sm text-content-muted mb-1">Entity ID</label>
                                <input className="input w-48" value={linkForm.entityId} onChange={e => setLinkForm(p => ({ ...p, entityId: e.target.value }))} id="link-entity-id" placeholder="Paste ID" />
                            </div>
                            <div>
                                <label className="block text-sm text-content-muted mb-1">Relation</label>
                                <Combobox hideSearch id="link-relation" selected={VENDOR_LINK_RELATION_OPTIONS.find(o => o.value === linkForm.relation) ?? null} setSelected={(opt) => setLinkForm(p => ({ ...p, relation: opt?.value ?? p.relation }))} options={VENDOR_LINK_RELATION_OPTIONS} matchTriggerWidth />
                            </div>
                            <Button variant="primary" id="submit-link-btn" onClick={async () => {
                                await fetch(apiUrl(`/vendors/${params.vendorId}/links`), {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(linkForm),
                                });
                                setShowLinkForm(false); setLinkForm({ entityType: 'ASSET', entityId: '', relation: 'RELATED' }); fetchLinks();
                            }}>Add</Button>
                        </div>
                    )}
                    {['ASSET', 'RISK', 'ISSUE', 'CONTROL'].map(type => {
                        const typeLinks = links.filter((l: any) => l.entityType === type);
                        if (typeLinks.length === 0) return null;
                        return (
                            <div key={type} className="card p-4 space-y-2">
                                <h3 className="text-sm font-semibold text-content-default">{type}s ({typeLinks.length})</h3>
                                {typeLinks.map((l: any) => (
                                    <div key={l.id} className="flex items-center justify-between text-sm border-b border-border-subtle py-1">
                                        <span><code className="text-xs text-content-info">{l.entityId}</code> <span className="badge badge-neutral text-xs ml-1">{l.relation}</span></span>
                                        {canWrite && <button className="text-content-error text-xs" onClick={async () => {
                                            await fetch(apiUrl(`/vendors/${params.vendorId}/links/${l.id}`), { method: 'DELETE' }); fetchLinks();
                                        }}>Remove</button>}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                    {links.length === 0 && <div className="card p-6 text-center text-content-subtle">No linked entities</div>}
                </div>
            )}

            {/* EVIDENCE BUNDLES */}
            {tab === 'bundles' && (
                <div className="space-y-4">
                    {canWrite && (
                        <div className="flex items-center gap-2 justify-end">
                            <input className="input w-48" placeholder="Bundle name…" value={bundleName}
                                onChange={e => setBundleName(e.target.value)} id="bundle-name-input" />
                            <Button variant="primary" disabled={!bundleName} id="create-bundle-btn" onClick={async () => {
                                await fetch(apiUrl(`/vendors/${params.vendorId}/bundles`), {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ name: bundleName }),
                                });
                                setBundleName(''); fetchBundles();
                            }}>+ New Bundle</Button>
                        </div>
                    )}
                    {bundles.map((b: any) => (
                        <div key={b.id} className="card p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="font-medium">{b.name}</span>
                                    <span className="ml-2 text-xs text-content-muted">{b._count?.items || 0} items</span>
                                    {b.frozenAt && <span className="badge badge-success ml-2">Frozen</span>}
                                </div>
                                {canWrite && !b.frozenAt && (
                                    <Button variant="secondary" size="xs" id={`freeze-bundle-${b.id}`} onClick={async () => {
                                        if (!confirm('Freeze this bundle? Items become immutable.')) return;
                                        await fetch(apiUrl(`/vendors/${params.vendorId}/bundles/${b.id}?action=freeze`), { method: 'POST' });
                                        fetchBundles();
                                    }}>Freeze</Button>
                                )}
                            </div>
                            <div className="text-xs text-content-muted">Created by {b.createdBy?.name || '—'} on {formatDate(b.createdAt)}</div>
                        </div>
                    ))}
                    {bundles.length === 0 && <div className="card p-6 text-center text-content-subtle">No evidence bundles</div>}
                </div>
            )}

            {/* SUBPROCESSORS */}
            {tab === 'subprocessors' && (
                <div className="space-y-4">
                    {canWrite && (
                        <div className="card p-4 flex items-end gap-3">
                            <div>
                                <label className="block text-sm text-content-muted mb-1">Subprocessor Vendor ID</label>
                                <input className="input w-48" value={subForm.subprocessorVendorId}
                                    onChange={e => setSubForm(p => ({ ...p, subprocessorVendorId: e.target.value }))} id="sub-vendor-id" placeholder="Paste vendor ID" />
                            </div>
                            <div>
                                <label className="block text-sm text-content-muted mb-1">Purpose</label>
                                <input className="input w-48" value={subForm.purpose}
                                    onChange={e => setSubForm(p => ({ ...p, purpose: e.target.value }))} id="sub-purpose" placeholder="e.g. Data hosting" />
                            </div>
                            <Button variant="primary" disabled={!subForm.subprocessorVendorId} id="add-subprocessor-btn" onClick={async () => {
                                await fetch(apiUrl(`/vendors/${params.vendorId}/subprocessors`), {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(subForm),
                                });
                                setSubForm({ subprocessorVendorId: '', purpose: '' }); fetchSubs();
                            }}>+ Add</Button>
                        </div>
                    )}
                    <div className="card overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="border-b border-border-default text-left text-xs uppercase text-content-muted">
                                <th className="p-3">Subprocessor</th><th className="p-3">Country</th>
                                <th className="p-3">Criticality</th><th className="p-3">Risk</th>
                                <th className="p-3">Purpose</th>
                                {canWrite && <th className="p-3"></th>}
                            </tr></thead>
                            <tbody>
                                {subs.map((s: any) => (
                                    <tr key={s.id} className="border-b border-border-subtle">
                                        <td className="p-3 font-medium">{s.subprocessor?.name || s.subprocessorVendorId}</td>
                                        <td className="p-3 text-content-muted">{s.subprocessor?.country || s.country || '—'}</td>
                                        <td className="p-3"><span className={`badge ${CRIT_BADGE[s.subprocessor?.criticality] || 'badge-neutral'}`}>{s.subprocessor?.criticality || '—'}</span></td>
                                        <td className="p-3">{s.subprocessor?.inherentRisk ? <span className={`badge ${CRIT_BADGE[s.subprocessor.inherentRisk]}`}>{s.subprocessor.inherentRisk}</span> : '—'}</td>
                                        <td className="p-3 text-content-muted text-xs">{s.purpose || '—'}</td>
                                        {canWrite && <td className="p-3"><button className="text-content-error text-xs" onClick={async () => {
                                            await fetch(apiUrl(`/vendors/${params.vendorId}/subprocessors?relationId=${s.id}`), { method: 'DELETE' }); fetchSubs();
                                        }}>Remove</button></td>}
                                    </tr>
                                ))}
                                {subs.length === 0 && <tr><td colSpan={6} className="text-center text-content-subtle py-8">No subprocessors</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
