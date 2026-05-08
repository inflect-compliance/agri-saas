'use client';

import type { SoAReportDTO, SoAEntryDTO } from '@/lib/dto/soa';
import { formatDate } from '@/lib/format-date';

interface SoAPrintViewProps {
    report: SoAReportDTO;
    tenantName: string;
}

/**
 * Print-optimized SoA view — clean multi-page document with CSS print styles.
 * No nav, no interactive elements. Users use browser print (Ctrl+P / Cmd+P).
 *
 * Print styles are in globals.css (moved there for CSP compliance — no inline <style> tags).
 */
export function SoAPrintView({ report, tenantName }: SoAPrintViewProps) {
    const { summary, entries } = report;
    // Epic 58 — canonical app-wide formatter so the printed SoA's
    // "Generated on" line reads identically to every other date in
    // the product ("16 Apr 2026").
    const generatedDate = formatDate(report.generatedAt);

    // Group entries by section
    const sections = [...new Set(entries.map(e => e.section || 'Other'))];
    const bySection = sections.map(s => ({
        name: s,
        entries: entries.filter(e => (e.section || 'Other') === s),
    }));

    return (
        <div className="soa-print-body bg-white text-black min-h-screen text-sm">
            {/* ─── Print toolbar (screen only) ─── */}
            <div className="no-print flex items-center justify-between mb-6 p-4 bg-slate-100 rounded-lg">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">SoA Print Preview</h2>
                    <p className="text-xs text-gray-500">Use Ctrl+P (or Cmd+P) to print or save as PDF</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => window.print()}
                        className="px-4 py-2 bg-bg-info-emphasis text-content-emphasis rounded-lg text-sm font-medium hover:bg-bg-info-emphasis transition-colors"
                    >
                        Print / Save as PDF
                    </button>
                    <button
                        onClick={() => window.history.back()}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors"
                    >
                        Back
                    </button>
                </div>
            </div>

            {/* ─── Cover section ─── */}
            <div className="print-page">
                <div className="border-b-2 border-gray-900 pb-4 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">Statement of Applicability</h1>
                    <p className="text-sm text-gray-600 mt-1">ISO/IEC 27001:2022 — Annex A Controls</p>
                </div>

                <table className="w-full text-sm mb-8">
                    <tbody>
                        <tr><td className="py-1 pr-4 font-semibold text-gray-700 w-48">Organization</td><td className="py-1">{tenantName}</td></tr>
                        <tr><td className="py-1 pr-4 font-semibold text-gray-700">Framework</td><td className="py-1">ISO/IEC 27001:2022</td></tr>
                        <tr><td className="py-1 pr-4 font-semibold text-gray-700">Generated</td><td className="py-1">{generatedDate}</td></tr>
                        <tr><td className="py-1 pr-4 font-semibold text-gray-700">Total Controls</td><td className="py-1">{summary.total}</td></tr>
                    </tbody>
                </table>

                {/* Summary */}
                <h2 className="text-lg font-bold text-gray-900 mb-3 border-b border-gray-300 pb-1">Summary</h2>
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <SummaryBox label="Applicable" value={summary.applicable} total={summary.total} color="green" />
                    <SummaryBox label="Not Applicable" value={summary.notApplicable} total={summary.total} color="gray" />
                    <SummaryBox label="Unmapped" value={summary.unmapped} total={summary.total} color="red" />
                    <SummaryBox label="Implemented" value={summary.implemented} total={summary.total} color="green" />
                    <SummaryBox label="Missing Justification" value={summary.missingJustification} total={summary.total} color="amber" />
                </div>
            </div>

            {/* ─── Detail tables per section ─── */}
            {bySection.map(section => (
                <div key={section.name} className="print-page">
                    <h2 className="text-lg font-bold text-gray-900 mb-3 border-b border-gray-300 pb-1">
                        {section.name} Controls
                        <span className="text-sm font-normal text-gray-500 ml-2">({section.entries.length})</span>
                    </h2>

                    <table className="print-table w-full text-xs border-collapse mb-6">
                        <thead>
                            <tr className="bg-gray-100">
                                <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold w-16">Code</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold">Requirement</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold w-20">Applicable</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold w-28">Status</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold">Control References</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold">Justification</th>
                            </tr>
                        </thead>
                        <tbody>
                            {section.entries.map(entry => (
                                <PrintRow key={entry.requirementId} entry={entry} />
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}

            {/* ─── Footer ─── */}
            <div className="text-xs text-gray-400 border-t border-gray-200 pt-4 mt-8">
                <p>Generated by Inflect Compliance on {generatedDate}. This document is a point-in-time snapshot and should be verified against current controls.</p>
            </div>
        </div>
    );
}

// ─── Print Row ───

function PrintRow({ entry }: { entry: SoAEntryDTO }) {
    const applicable = entry.applicable === true ? 'Yes'
        : entry.applicable === false ? 'No'
        : 'Unmapped';

    const applicableClass = entry.applicable === true ? 'text-content-success'
        : entry.applicable === false ? 'text-gray-600'
        : 'text-content-error font-semibold';

    const controlRefs = entry.mappedControls
        .map(c => `${c.code || '—'} — ${c.title}`)
        .join('\n');

    return (
        <tr className={entry.applicable === null ? 'bg-bg-error-emphasis' : ''}>
            <td className="border border-gray-300 px-2 py-1.5 font-mono text-xs">{entry.requirementCode}</td>
            <td className="border border-gray-300 px-2 py-1.5">{entry.requirementTitle}</td>
            <td className={`border border-gray-300 px-2 py-1.5 font-medium ${applicableClass}`}>{applicable}</td>
            <td className="border border-gray-300 px-2 py-1.5">{entry.implementationStatus?.replace(/_/g, ' ') || '—'}</td>
            <td className="border border-gray-300 px-2 py-1.5 whitespace-pre-line">{controlRefs || '—'}</td>
            <td className="border border-gray-300 px-2 py-1.5 text-gray-600">{entry.justification || '—'}</td>
        </tr>
    );
}

// ─── Summary Box ───

function SummaryBox({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
    const percent = total > 0 ? Math.round((value / total) * 100) : 0;
    const colorMap: Record<string, string> = {
        green: 'border-border-success bg-bg-success-emphasis',
        gray: 'border-gray-400 bg-gray-50',
        red: 'border-border-error bg-bg-error-emphasis',
        amber: 'border-border-warning bg-bg-warning-emphasis',
    };

    return (
        <div className={`border-l-4 ${colorMap[color] || 'border-gray-300'} px-3 py-2`}>
            <div className="text-xl font-bold text-gray-900">{value} <span className="text-xs font-normal text-gray-500">({percent}%)</span></div>
            <div className="text-xs text-gray-600">{label}</div>
        </div>
    );
}
