'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Search, X, FilterX, Link2, FileText, AlertTriangle,
    CheckCircle2, XCircle, HelpCircle, ChevronDown, Check,
    Download, Plus, MessageSquare,
} from 'lucide-react';
import type { SoAReportDTO, SoAEntryDTO } from '@/lib/dto/soa';
import { PdfExportButton } from '@/components/PdfExportButton';
import { RequirePermission } from '@/components/require-permission';
import { Modal } from '@/components/ui/modal';
import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';

// ─── Types ───

interface ControlOption {
    id: string;
    code: string | null;
    name: string;
    status: string;
}

interface SoAClientProps {
    report: SoAReportDTO;
    controls: ControlOption[];
    tenantSlug: string;
    canEdit: boolean;
}

// ─── Badge helpers ───

function ApplicabilityBadge({ value }: { value: boolean | null }) {
    if (value === true)  return <span className="badge badge-success">Applicable</span>;
    if (value === false) return <span className="badge badge-neutral">Not Applicable</span>;
    return <span className="badge badge-danger">Unmapped</span>;
}

function StatusBadge({ value }: { value: string | null }) {
    if (!value) return <span className="text-content-subtle text-xs">—</span>;
    const cls: Record<string, string> = {
        IMPLEMENTED: 'badge-success',
        IN_PROGRESS: 'badge-info',
        NEEDS_REVIEW: 'badge-warning',
        NOT_STARTED: 'badge-neutral',
    };
    return <span className={`badge ${cls[value] || 'badge-neutral'}`}>{value.replace(/_/g, ' ')}</span>;
}

function GapBadges({ entry }: { entry: SoAEntryDTO }) {
    const gaps: React.JSX.Element[] = [];
    if (entry.applicable === null) {
        gaps.push(
            <span key="unmapped" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-bg-error text-content-error border border-border-error">
                <AlertTriangle className="w-3 h-3" /> Unmapped
            </span>
        );
    }
    if (entry.applicable === false) {
        const hasMissing = entry.mappedControls.some(c => c.applicability === 'NOT_APPLICABLE' && !c.justification);
        if (hasMissing) {
            gaps.push(
                <span key="justification" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-bg-warning text-content-warning border border-border-warning">
                    <MessageSquare className="w-3 h-3" /> Justification missing
                </span>
            );
        }
    }
    return gaps.length > 0 ? <div className="flex flex-wrap gap-1">{gaps}</div> : null;
}

// ─── Main Component ───

export function SoAClient({ report, controls, tenantSlug, canEdit }: SoAClientProps) {
    const router = useRouter();
    const [search, setSearch] = useState('');
    const [gapsOnly, setGapsOnly] = useState(false);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    // Modal state
    const [mapModal, setMapModal] = useState<{ requirementId: string; requirementCode: string } | null>(null);
    const [justModal, setJustModal] = useState<{ controlId: string; controlCode: string; requirementCode: string } | null>(null);
    const [mapControlSearch, setMapControlSearch] = useState('');
    const [justText, setJustText] = useState('');
    const [saving, setSaving] = useState(false);

    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);

    // ─── Filtering ───

    const filteredEntries = useMemo(() => {
        let entries = report.entries;

        if (search) {
            const q = search.toLowerCase();
            entries = entries.filter(e =>
                e.requirementCode.toLowerCase().includes(q) ||
                e.requirementTitle.toLowerCase().includes(q) ||
                (e.section || '').toLowerCase().includes(q)
            );
        }

        if (gapsOnly) {
            entries = entries.filter(e => {
                if (e.applicable === null) return true; // unmapped
                if (e.applicable === false) {
                    return e.mappedControls.some(c => c.applicability === 'NOT_APPLICABLE' && !c.justification);
                }
                return false;
            });
        }

        return entries;
    }, [report.entries, search, gapsOnly]);

    // ─── Actions ───

    const handleMapControl = async (controlId: string) => {
        if (!mapModal) return;
        setSaving(true);
        try {
            const res = await fetch(apiUrl('/reports/soa/map'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requirementId: mapModal.requirementId, controlId }),
            });
            if (!res.ok) throw new Error('Failed to map');
            setMapModal(null);
            setMapControlSearch('');
            router.refresh();
        } finally {
            setSaving(false);
        }
    };

    const handleSaveJustification = async () => {
        if (!justModal) return;
        setSaving(true);
        try {
            const res = await fetch(apiUrl(`/controls/${justModal.controlId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    applicability: 'NOT_APPLICABLE',
                    applicabilityJustification: justText,
                }),
            });
            if (!res.ok) throw new Error('Failed to save');
            setJustModal(null);
            setJustText('');
            router.refresh();
        } finally {
            setSaving(false);
        }
    };

    // Filtered controls for map modal
    const mapFilteredControls = useMemo(() => {
        if (!mapControlSearch) return controls;
        const q = mapControlSearch.toLowerCase();
        return controls.filter(c =>
            (c.code || '').toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q)
        );
    }, [controls, mapControlSearch]);

    const { summary } = report;

    return (
        <>
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold" id="soa-heading">Statement of Applicability</h1>
                    <p className="text-content-muted text-sm">ISO 27001:2022 Annex A — {summary.total} requirements</p>
                </div>
                <RequirePermission resource="reports" action="export">
                    <div className="flex flex-wrap gap-2">
                        <a
                            href={`/api/t/${tenantSlug}/reports/soa/export.csv`}
                            className={buttonVariants({ variant: 'secondary' })}
                            download
                            id="export-soa-btn"
                        >
                            <Download className="w-3.5 h-3.5" /> Export CSV
                        </a>
                        <PdfExportButton
                            tenantSlug={tenantSlug}
                            reportType="AUDIT_READINESS"
                            label="Audit Readiness PDF"
                            allowSave={canEdit}
                        />
                        <PdfExportButton
                            tenantSlug={tenantSlug}
                            reportType="GAP_ANALYSIS"
                            label="Gap Analysis PDF"
                            allowSave={canEdit}
                        />
                    </div>
                </RequirePermission>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <SummaryCard label="Total" value={summary.total} icon={<FileText className="w-4 h-4 text-content-muted" />} />
                <SummaryCard label="Applicable" value={summary.applicable} icon={<CheckCircle2 className="w-4 h-4 text-content-success" />} />
                <SummaryCard label="Not Applicable" value={summary.notApplicable} icon={<XCircle className="w-4 h-4 text-content-muted" />} />
                <SummaryCard label="Unmapped" value={summary.unmapped} icon={<HelpCircle className="w-4 h-4 text-content-error" />} accent={summary.unmapped > 0 ? 'danger' : undefined} />
                <SummaryCard label="Implemented" value={summary.implemented} icon={<CheckCircle2 className="w-4 h-4 text-content-success" />} />
                <SummaryCard label="Missing Justification" value={summary.missingJustification} icon={<AlertTriangle className="w-4 h-4 text-content-warning" />} accent={summary.missingJustification > 0 ? 'warning' : undefined} />
            </div>

            {/* Readiness banner */}
            {(summary.unmapped > 0 || summary.missingJustification > 0) && (
                <div className="rounded-xl border border-border-error bg-bg-error px-4 py-3 flex items-center justify-between" id="soa-readiness-banner">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-content-error flex-shrink-0" />
                        <div className="text-xs text-content-error">
                            <span className="font-semibold">SoA not audit-ready:</span>
                            {summary.unmapped > 0 && <span className="ml-1">{summary.unmapped} unmapped requirement{summary.unmapped > 1 ? 's' : ''}</span>}
                            {summary.unmapped > 0 && summary.missingJustification > 0 && <span>, </span>}
                            {summary.missingJustification > 0 && <span>{summary.missingJustification} missing justification{summary.missingJustification > 1 ? 's' : ''}</span>}
                        </div>
                    </div>
                    <Button
                        variant="danger"
                        size="xs"
                        onClick={() => setGapsOnly(true)}
                    >
                        Fix now
                    </Button>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-subtle" />
                    <input
                        type="text"
                        className="w-full pl-8 pr-8 py-1.5 text-xs bg-bg-default/60 border border-border-emphasis/50 rounded-full text-content-emphasis placeholder-content-subtle focus:outline-none focus:border-[var(--brand-default)]/50 focus:ring-1 focus:ring-[var(--brand-default)]/20 transition-all"
                        placeholder="Search by code or title…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        id="soa-search"
                    />
                    {search && (
                        <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-content-subtle hover:text-content-default"
                            onClick={() => setSearch('')}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                <Button
                    variant={gapsOnly ? 'danger' : 'ghost'}
                    onClick={() => setGapsOnly(!gapsOnly)}
                    id="soa-gaps-only"
                >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {gapsOnly ? 'Showing gaps only' : 'Show gaps only'}
                </Button>

                {(search || gapsOnly) && (
                    <Button
                        variant="ghost"
                        onClick={() => { setSearch(''); setGapsOnly(false); }}
                    >
                        <FilterX className="w-3.5 h-3.5" /> Clear
                    </Button>
                )}

                <span className="text-xs text-content-subtle ml-auto">
                    {filteredEntries.length} of {report.entries.length} requirements
                </span>
            </div>

            {/* Table */}
            <div className="glass-card overflow-auto">
                <table className="data-table" id="soa-table">
                    <thead>
                        <tr>
                            <th className="w-24">Code</th>
                            <th>Requirement</th>
                            <th>Applicability</th>
                            <th>Status</th>
                            <th>Controls</th>
                            <th>Gaps</th>
                            {canEdit && <th className="w-20">Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEntries.map(entry => (
                            <SoARow
                                key={entry.requirementId}
                                entry={entry}
                                expanded={expandedRow === entry.requirementId}
                                onToggle={() => setExpandedRow(expandedRow === entry.requirementId ? null : entry.requirementId)}
                                canEdit={canEdit}
                                onMap={() => setMapModal({ requirementId: entry.requirementId, requirementCode: entry.requirementCode })}
                                onJustify={(controlId, controlCode) => {
                                    setJustModal({ controlId, controlCode, requirementCode: entry.requirementCode });
                                    setJustText('');
                                }}
                                tenantSlug={tenantSlug}
                            />
                        ))}
                        {filteredEntries.length === 0 && (
                            <tr>
                                <td colSpan={canEdit ? 7 : 6} className="text-center text-content-subtle py-8">
                                    {gapsOnly ? 'No gaps found — all requirements are mapped with justifications!' : 'No matching requirements'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Map Control Modal — shared <Modal> (Epic 54) */}
            <Modal
                showModal={!!mapModal}
                setShowModal={(v) => {
                    const next = typeof v === 'function' ? v(!!mapModal) : v;
                    if (!next && !saving) setMapModal(null);
                }}
                size="md"
                title="Map control"
                description={
                    mapModal
                        ? `Map a tenant control to requirement ${mapModal.requirementCode}.`
                        : undefined
                }
                preventDefaultClose={saving}
            >
                <Modal.Header
                    title={
                        mapModal
                            ? `Map control to ${mapModal.requirementCode}`
                            : 'Map control'
                    }
                    description="Select a tenant control to map to this Annex A requirement."
                />
                <Modal.Body>
                    <input
                        type="text"
                        className="input mb-3 w-full"
                        placeholder="Search controls…"
                        value={mapControlSearch}
                        onChange={(e) => setMapControlSearch(e.target.value)}
                        autoFocus
                    />
                    <div className="max-h-60 space-y-1 overflow-y-auto">
                        {mapFilteredControls.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-bg-muted"
                                onClick={() => handleMapControl(c.id)}
                                disabled={saving}
                            >
                                <div>
                                    <span className="font-mono text-brand-emphasis">
                                        {c.code || '—'}
                                    </span>
                                    <span className="ml-2 text-content-emphasis">
                                        {c.name}
                                    </span>
                                </div>
                                <span
                                    className={`badge ${c.status === 'IMPLEMENTED' ? 'badge-success' : 'badge-neutral'}`}
                                >
                                    {c.status}
                                </span>
                            </button>
                        ))}
                        {mapFilteredControls.length === 0 && (
                            <p className="py-4 text-center text-xs text-content-muted">
                                No controls found
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setMapModal(null)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                </Modal.Actions>
            </Modal>

            {/* Justification Modal — shared <Modal> (Epic 54) */}
            <Modal
                showModal={!!justModal}
                setShowModal={(v) => {
                    const next = typeof v === 'function' ? v(!!justModal) : v;
                    if (!next && !saving) setJustModal(null);
                }}
                size="sm"
                title="Add justification"
                description={
                    justModal
                        ? `Justify why ${justModal.controlCode} is not applicable for ${justModal.requirementCode}.`
                        : undefined
                }
                preventDefaultClose={saving}
            >
                <Modal.Header
                    title="Add justification"
                    description={
                        justModal ? (
                            <>
                                Justify why control{' '}
                                <span className="font-mono text-brand-emphasis">
                                    {justModal.controlCode}
                                </span>{' '}
                                is not applicable for requirement{' '}
                                {justModal.requirementCode}.
                            </>
                        ) : null
                    }
                />
                <Modal.Body>
                    <textarea
                        className="input min-h-[100px] w-full"
                        placeholder="e.g. Fully remote company — no physical premises to secure."
                        value={justText}
                        onChange={(e) => setJustText(e.target.value)}
                        autoFocus
                        disabled={saving}
                    />
                </Modal.Body>
                <Modal.Actions>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setJustModal(null)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveJustification}
                        disabled={saving || !justText.trim()}
                    >
                        {saving ? 'Saving…' : 'Save justification'}
                    </Button>
                </Modal.Actions>
            </Modal>
        </>
    );
}

// ─── Row Component ───

function SoARow({
    entry, expanded, onToggle, canEdit, onMap, onJustify, tenantSlug,
}: {
    entry: SoAEntryDTO;
    expanded: boolean;
    onToggle: () => void;
    canEdit: boolean;
    onMap: () => void;
    onJustify: (controlId: string, controlCode: string) => void;
    tenantSlug: string;
}) {
    const hasGap = entry.applicable === null || (
        entry.applicable === false &&
        entry.mappedControls.some(c => c.applicability === 'NOT_APPLICABLE' && !c.justification)
    );

    return (
        <>
            <tr className={`${hasGap ? 'bg-bg-error' : ''} cursor-pointer hover:bg-bg-elevated/30`} onClick={onToggle}>
                <td className="text-xs font-mono text-[var(--brand-default)]">{entry.requirementCode}</td>
                <td className="text-sm text-content-emphasis">
                    <div>{entry.requirementTitle}</div>
                    {entry.section && <div className="text-[10px] text-content-subtle">{entry.section}</div>}
                </td>
                <td><ApplicabilityBadge value={entry.applicable} /></td>
                <td><StatusBadge value={entry.implementationStatus} /></td>
                <td className="text-xs text-content-muted">
                    {entry.mappedControls.length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> {entry.mappedControls.length}
                        </span>
                    ) : '—'}
                </td>
                <td><GapBadges entry={entry} /></td>
                {canEdit && (
                    <td>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            {entry.applicable === null && (
                                <Tooltip content="Map control">
                                    <Button
                                        variant="primary"
                                        size="xs"
                                        onClick={onMap}
                                        aria-label="Map control"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </Button>
                                </Tooltip>
                            )}
                        </div>
                    </td>
                )}
            </tr>
            {expanded && entry.mappedControls.length > 0 && (
                <tr className="bg-bg-default/40">
                    <td colSpan={canEdit ? 7 : 6} className="p-0">
                        <div className="px-6 py-3 space-y-2">
                            <div className="text-[10px] uppercase tracking-wider text-content-subtle font-semibold">Mapped Controls</div>
                            {entry.mappedControls.map(c => (
                                <div key={c.controlId} className="flex items-center justify-between text-xs bg-bg-page/40 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-3">
                                        <a
                                            href={`/t/${tenantSlug}/controls/${c.controlId}`}
                                            className="font-mono text-[var(--brand-default)] hover:underline"
                                            onClick={e => e.stopPropagation()}
                                        >
                                            {c.code || c.controlId.slice(0, 8)}
                                        </a>
                                        <span className="text-content-emphasis">{c.title}</span>
                                        <span className={`badge ${c.applicability === 'APPLICABLE' ? 'badge-success' : 'badge-neutral'}`}>
                                            {c.applicability}
                                        </span>
                                        <StatusBadge value={c.status} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {c.justification && (
                                            <span className="text-content-muted max-w-[200px] truncate" title={c.justification}>
                                                {c.justification}
                                            </span>
                                        )}
                                        {c.applicability === 'NOT_APPLICABLE' && !c.justification && canEdit && (
                                            <Button
                                                variant="danger"
                                                size="xs"
                                                onClick={(e) => { e.stopPropagation(); onJustify(c.controlId, c.code || c.controlId.slice(0, 8)); }}
                                            >
                                                <MessageSquare className="w-3 h-3" /> Justify
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {entry.evidenceCount > 0 && (
                                <div className="text-[10px] text-content-subtle">Evidence: {entry.evidenceCount} items</div>
                            )}
                            {entry.openTaskCount > 0 && (
                                <div className="text-[10px] text-content-warning">Open tasks: {entry.openTaskCount}</div>
                            )}
                            {entry.lastTestResult && (
                                <div className="text-[10px] text-content-subtle">
                                    Last test: <span className={entry.lastTestResult === 'PASS' ? 'text-content-success' : 'text-content-error'}>{entry.lastTestResult}</span>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// ─── Summary Card ───

function SummaryCard({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent?: 'danger' | 'warning' }) {
    const border = accent === 'danger' ? 'border-border-error' : accent === 'warning' ? 'border-border-warning' : 'border-border-default/50';
    return (
        <div className={`glass-card px-4 py-3 border ${border}`}>
            <div className="flex items-center justify-between">
                {icon}
                <span className="text-xl font-bold text-content-emphasis">{value}</span>
            </div>
            <div className="text-[10px] text-content-muted mt-1">{label}</div>
        </div>
    );
}
