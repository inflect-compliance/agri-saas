'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
    FilterX, Link2, FileText, AlertTriangle,
    CheckCircle2, XCircle, HelpCircle,
    Plus, MessageSquare,
} from 'lucide-react';
import type { SoAReportDTO, SoAEntryDTO } from '@/lib/dto/soa';
import { Modal } from '@/components/ui/modal';
import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { textLinkVariants } from '@/components/ui/typography';
import { StatusBadge as StatusBadgePrimitive, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { cardVariants } from '@/components/ui/card';
import { InlineEmptyState } from '@/components/ui/inline-empty-state';
import { cn } from '@/lib/cn';

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
    const t = useTranslations('reports.soaReport');
    if (value === true)  return <StatusBadgePrimitive variant="success">{t('applicable')}</StatusBadgePrimitive>;
    if (value === false) return <StatusBadgePrimitive variant="neutral">{t('notApplicable')}</StatusBadgePrimitive>;
    return <StatusBadgePrimitive variant="error">{t('unmapped')}</StatusBadgePrimitive>;
}

function StatusBadge({ value }: { value: string | null }) {
    if (!value) return <span className="text-content-subtle text-xs">—</span>;
    const cls: Record<string, StatusBadgeVariant> = {
        IMPLEMENTED: 'success',
        IN_PROGRESS: 'info',
        NEEDS_REVIEW: 'warning',
        NOT_STARTED: 'neutral',
    };
    return <StatusBadgePrimitive variant={cls[value] || 'neutral'}>{value.replace(/_/g, ' ')}</StatusBadgePrimitive>;
}

function GapBadges({ entry }: { entry: SoAEntryDTO }) {
    // Roadmap-2 PR-7 — gap badges flow through the canonical
    // `<StatusBadgePrimitive>` so the pill shape, size, and tone-
    // mapping match every other status across the product.
    const t = useTranslations('reports.soaReport');
    const gaps: React.JSX.Element[] = [];
    if (entry.applicable === null) {
        gaps.push(
            <StatusBadgePrimitive key="unmapped" variant="error">
                <AlertTriangle className="w-3.5 h-3.5" /> {t('unmapped')}
            </StatusBadgePrimitive>
        );
    }
    if (entry.applicable === false) {
        const hasMissing = entry.mappedControls.some(c => c.applicability === 'NOT_APPLICABLE' && !c.justification);
        if (hasMissing) {
            gaps.push(
                <StatusBadgePrimitive key="justification" variant="warning">
                    <MessageSquare className="w-3.5 h-3.5" /> {t('justificationMissing')}
                </StatusBadgePrimitive>
            );
        }
    }
    return gaps.length > 0 ? <div className="flex flex-wrap gap-1">{gaps}</div> : null;
}

// ─── Main Component ───

export function SoAClient({ report, controls, tenantSlug, canEdit }: SoAClientProps) {
    const t = useTranslations('reports.soaReport');
    const router = useRouter();
    // R14-PR7 — standalone main-page search retired. The "Show gaps
    // only" toggle remains as the primary in-page filter; users
    // looking for a specific requirement use the global command
    // palette (⌘K) or the Annex A code list. The MODAL search (for
    // picking a control to map) stays — it's a picker affordance,
    // not a page-level search.
    const [gapsOnly, setGapsOnly] = useState(false);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    // Modal state
    const [mapModal, setMapModal] = useState<{ requirementId: string; requirementCode: string } | null>(null);
    const [justModal, setJustModal] = useState<{ controlId: string; controlCode: string; requirementCode: string } | null>(null);
    // Searchbar-kill sweep — the modal's `<input>` was retired
    // alongside every other in-app search bar. The modal now lists
    // controls unfiltered; users find a specific control via the
    // ⌘K palette (which navigates) or scroll the list.
    const [justText, setJustText] = useState('');
    const [saving, setSaving] = useState(false);

    const apiUrl = useCallback((path: string) => `/api/t/${tenantSlug}${path}`, [tenantSlug]);

    // ─── Filtering ───

    const filteredEntries = useMemo(() => {
        let entries = report.entries;

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
    }, [report.entries, gapsOnly]);

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

    // Modal control list — searchbar retired; full list shown.
    const mapFilteredControls = controls;

    const { summary } = report;

    return (
        // Roadmap-2 PR-12 — SoAClient is embedded inside the
        // Reports page now; the parent owns the H1 + breadcrumbs.
        // The duplicate H1 + subtitle + export-button cluster
        // that used to live here are gone (the export buttons
        // moved up to the Reports header so they sit in the
        // same place as the Risk Register's exports). The body
        // gets `space-y-section` so summary / banner / filters /
        // table breathe at the canonical 32px rhythm.
        <div className="space-y-section animate-fadeIn">
            {/* Eyebrow + summary line — section-level, not page-level */}
            <div>
                <p className="text-sm text-content-muted">
                    {report.frameworkName} — {t('requirementsSummary', { count: summary.total })}
                </p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-compact">
                <SummaryCard label={t('total')} value={summary.total} icon={<FileText className="w-4 h-4 text-content-muted" />} />
                <SummaryCard label={t('applicable')} value={summary.applicable} icon={<CheckCircle2 className="w-4 h-4 text-content-success" />} />
                <SummaryCard label={t('notApplicable')} value={summary.notApplicable} icon={<XCircle className="w-4 h-4 text-content-muted" />} />
                <SummaryCard label={t('unmapped')} value={summary.unmapped} icon={<HelpCircle className="w-4 h-4 text-content-error" />} accent={summary.unmapped > 0 ? 'danger' : undefined} />
                <SummaryCard label={t('implemented')} value={summary.implemented} icon={<CheckCircle2 className="w-4 h-4 text-content-success" />} />
                <SummaryCard label={t('missingJustification')} value={summary.missingJustification} icon={<AlertTriangle className="w-4 h-4 text-content-warning" />} accent={summary.missingJustification > 0 ? 'warning' : undefined} />
            </div>

            {/* Readiness banner */}
            {(summary.unmapped > 0 || summary.missingJustification > 0) && (
                <div className="rounded-lg border border-border-error bg-bg-error px-4 py-3 flex items-center justify-between" id="soa-readiness-banner">
                    <div className="flex items-center gap-tight">
                        <AlertTriangle className="w-4 h-4 text-content-error flex-shrink-0" />
                        <div className="text-xs text-content-error">
                            <span className="font-semibold">{t('notAuditReady')}</span>
                            {summary.unmapped > 0 && <span className="ml-1">{t('unmappedRequirements', { count: summary.unmapped })}</span>}
                            {summary.unmapped > 0 && summary.missingJustification > 0 && <span>, </span>}
                            {summary.missingJustification > 0 && <span>{t('missingJustifications', { count: summary.missingJustification })}</span>}
                        </div>
                    </div>
                    <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => setGapsOnly(true)}
                    >
                        {t('fixNow')}
                    </Button>
                </div>
            )}

            {/* Filters — R14-PR7 dropped the main-page search input.
                The "Show gaps only" toggle remains; cross-page
                navigation goes through ⌘K. */}
            <div className="flex flex-wrap items-center gap-tight">
                <Button
                    variant={gapsOnly ? 'destructive' : 'ghost'}
                    onClick={() => setGapsOnly(!gapsOnly)}
                    id="soa-gaps-only"
                >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {gapsOnly ? t('showingGapsOnly') : t('showGapsOnly')}
                </Button>

                {gapsOnly && (
                    <Button
                        variant="ghost"
                        onClick={() => setGapsOnly(false)}
                    >
                        <FilterX className="w-3.5 h-3.5" /> {t('clear')}
                    </Button>
                )}

                <span className="text-xs text-content-subtle ml-auto">
                    {t('filteredCount', { count: filteredEntries.length, total: report.entries.length })}
                </span>
            </div>

            {/* Table.
                PR-A — match the Controls / Risks / Assets list-page
                card density. Pre-PR-A this used `density: 'none'`
                which read as a borderless overflow scroller; consumers
                navigating between Reports + Controls felt the
                presentation jump. Default density gives the same
                inset padding ratio the DataTable card uses on the
                other list pages. */}
            <div
                className={cn(cardVariants(), 'overflow-auto')}
                data-testid="soa-table-card"
            >
                <table className="data-table" id="soa-table">
                    <thead>
                        <tr>
                            <th className="w-24">{t('colCode')}</th>
                            <th>{t('colRequirement')}</th>
                            <th>{t('colApplicability')}</th>
                            <th>{t('colStatus')}</th>
                            <th>{t('colControls')}</th>
                            <th>{t('colGaps')}</th>
                            {canEdit && <th className="w-20">{t('colActions')}</th>}
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
                                    {gapsOnly ? t('noGaps') : t('noMatching')}
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
                title={t('mapControl')}
                description={
                    mapModal
                        ? t('mapControlToRequirement', { code: mapModal.requirementCode })
                        : undefined
                }
                preventDefaultClose={saving}
            >
                <Modal.Header
                    title={
                        mapModal
                            ? t('mapControlTo', { code: mapModal.requirementCode })
                            : t('mapControl')
                    }
                    description={t('mapControlHeaderDescription')}
                />
                <Modal.Body>
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
                                <StatusBadgePrimitive variant={c.status === 'IMPLEMENTED' ? 'success' : 'neutral'}>
                                    {c.status}
                                </StatusBadgePrimitive>
                            </button>
                        ))}
                        {mapFilteredControls.length === 0 && (
                            <InlineEmptyState title={t('noControls')} />
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
                        {t('cancel')}
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
                title={t('addJustification')}
                description={
                    justModal
                        ? t('justifyModalDescription', { controlCode: justModal.controlCode, requirementCode: justModal.requirementCode })
                        : undefined
                }
                preventDefaultClose={saving}
            >
                <Modal.Header
                    title={t('addJustification')}
                    description={
                        justModal ? (
                            <>
                                {t('justifyHeaderPrefix')}{' '}
                                <span className="font-mono text-brand-emphasis">
                                    {justModal.controlCode}
                                </span>{' '}
                                {t('justifyHeaderSuffix', { requirementCode: justModal.requirementCode })}
                            </>
                        ) : null
                    }
                />
                <Modal.Body>
                    <textarea
                        className="input min-h-[100px] w-full"
                        placeholder={t('justificationPlaceholder')}
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
                        {t('cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveJustification}
                        disabled={saving || !justText.trim()}
                    >
                        {saving ? t('saving') : t('saveJustification')}
                    </Button>
                </Modal.Actions>
            </Modal>
        </div>
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
    const t = useTranslations('reports.soaReport');
    const hasGap = entry.applicable === null || (
        entry.applicable === false &&
        entry.mappedControls.some(c => c.applicability === 'NOT_APPLICABLE' && !c.justification)
    );

    return (
        <>
            <tr className={`${hasGap ? 'bg-bg-error' : ''} cursor-pointer hover:bg-bg-muted/50`} onClick={onToggle}>
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
                            <Link2 className="w-3.5 h-3.5" /> {entry.mappedControls.length}
                        </span>
                    ) : '—'}
                </td>
                <td><GapBadges entry={entry} /></td>
                {canEdit && (
                    <td>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            {entry.applicable === null && (
                                <Tooltip content={t('mapControl')}>
                                    <Button
                                        variant="primary"
                                        size="xs"
                                        onClick={onMap}
                                        aria-label={t('mapControl')}
                                    >
                                        <Plus className="w-3.5 h-3.5" />
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
                        <div className="px-6 py-3 space-y-tight">
                            <div className="text-[10px] uppercase tracking-wider text-content-subtle font-semibold">{t('mappedControls')}</div>
                            {entry.mappedControls.map(c => (
                                <div key={c.controlId} className="flex items-center justify-between text-xs bg-bg-page/40 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-compact">
                                        <a
                                            href={`/t/${tenantSlug}/controls/${c.controlId}`}
                                            className={`${textLinkVariants({ tone: 'link' })} font-mono`}
                                            onClick={e => e.stopPropagation()}
                                        >
                                            {c.code || c.controlId.slice(0, 8)}
                                        </a>
                                        <span className="text-content-emphasis">{c.title}</span>
                                        <StatusBadgePrimitive variant={c.applicability === 'APPLICABLE' ? 'success' : 'neutral'}>
                                            {c.applicability}
                                        </StatusBadgePrimitive>
                                        <StatusBadge value={c.status} />
                                    </div>
                                    <div className="flex items-center gap-tight">
                                        {c.justification && (
                                            <span className="text-content-muted max-w-trunc-default truncate" title={c.justification}>
                                                {c.justification}
                                            </span>
                                        )}
                                        {c.applicability === 'NOT_APPLICABLE' && !c.justification && canEdit && (
                                            <Button
                                                variant="destructive"
                                                size="xs"
                                                onClick={(e) => { e.stopPropagation(); onJustify(c.controlId, c.code || c.controlId.slice(0, 8)); }}
                                            >
                                                <MessageSquare className="w-3.5 h-3.5" /> {t('justify')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {entry.evidenceCount > 0 && (
                                <div className="text-[10px] text-content-subtle">{t('evidenceItems', { count: entry.evidenceCount })}</div>
                            )}
                            {entry.openTaskCount > 0 && (
                                <div className="text-[10px] text-content-warning">{t('openTasks', { count: entry.openTaskCount })}</div>
                            )}
                            {entry.lastTestResult && (
                                <div className="text-[10px] text-content-subtle">
                                    {t('lastTest')} <span className={entry.lastTestResult === 'PASS' ? 'text-content-success' : 'text-content-error'}>{entry.lastTestResult}</span>
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
        <div className={cn(cardVariants({ density: 'none' }), 'px-4 py-3 border', border)}>
            <div className="flex items-center justify-between">
                {icon}
                <span className="text-xl font-bold text-content-emphasis">{value}</span>
            </div>
            <div className="text-[10px] text-content-muted mt-1">{label}</div>
        </div>
    );
}
