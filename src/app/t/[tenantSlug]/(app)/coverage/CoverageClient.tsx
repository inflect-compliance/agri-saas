'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { useMemo } from 'react';
import { ShieldCheck, AlertTriangle, Cpu, Flame, ArrowLeft } from 'lucide-react';
import DonutChart from '@/components/ui/DonutChart';
import { DataTable, createColumns } from '@/components/ui/table';
import { ProgressBar } from '@/components/ui/progress-bar';

// ─── Types ──────────────────────────────────────────────────────────

interface CoverageData {
    totalRisks: number;
    totalControls: number;
    totalAssets: number;
    risksWithControlsCount: number;
    risksWithControlsPct: number;
    controlsWithRisksCount: number;
    controlsWithRisksPct: number;
    assetsWithControlsCount: number;
    assetsWithControlsPct: number;
    unmappedRisks: Array<{ id: string; title: string; score: number; status: string }>;
    uncoveredCriticalAssets: Array<{ id: string; name: string; type: string; criticality: string }>;
    hotControls: Array<{ id: string; code?: string; name: string; riskCount: number }>;
}

interface CoverageClientProps {
    data: CoverageData;
    tenantSlug: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function pctColor(pct: number): string {
    if (pct >= 80) return '#22c55e';
    if (pct >= 50) return '#f59e0b';
    return '#ef4444';
}

/**
 * GAP-CI-77: text variant of pctColor — returns a Tailwind class that
 * targets a semantic status token. Hex Tailwind mid-tones above fail
 * WCAG AA against light-theme cream (~3.0:1); the semantic tokens are
 * tuned to ≥4.5:1 in both themes. Used wherever the colour is applied
 * to actual text; DonutChart segments still use the hex directly via
 * `pctColor` because SVG fills aren't gated by WCAG text rules.
 */
function pctTextClass(pct: number): string {
    if (pct >= 80) return 'text-content-success';
    if (pct >= 50) return 'text-content-warning';
    return 'text-content-error';
}

function pctGradient(pct: number): string {
    if (pct >= 80) return 'from-emerald-500 to-teal-500';
    if (pct >= 50) return 'from-amber-500 to-yellow-500';
    return 'from-red-500 to-rose-500';
}

function statusBadge(status: string) {
    const colors: Record<string, string> = {
        OPEN: 'badge-warning',
        MITIGATING: 'badge-info',
        CLOSED: 'badge-success',
        ACCEPTED: 'badge-neutral',
    };
    return colors[status] || 'badge-neutral';
}

function critBadge(crit: string) {
    const colors: Record<string, string> = {
        HIGH: 'badge-danger',
        MEDIUM: 'badge-warning',
        LOW: 'badge-success',
    };
    return colors[crit] || 'badge-neutral';
}

// ─── Component ──────────────────────────────────────────────────────

export function CoverageClient({ data, tenantSlug }: CoverageClientProps) {
    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;

    // ── Column definitions ────────────────────────────────────────

    const unmappedRiskCols = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: 'Risk',
            cell: ({ getValue }: any) => (
                <span className="font-medium text-content-emphasis">{getValue()}</span>
            ),
        },
        {
            accessorKey: 'score',
            header: 'Score',
            cell: ({ getValue }: any) => {
                const score = getValue() as number;
                return (
                    <span className={`text-sm font-semibold tabular-nums ${
                        score >= 15 ? 'text-content-error' : score >= 9 ? 'text-content-warning' : 'text-content-success'
                    }`}>
                        {score}
                    </span>
                );
            },
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ getValue }: any) => (
                <span className={`badge ${statusBadge(getValue())}`}>
                    {String(getValue()).replace(/_/g, ' ')}
                </span>
            ),
        },
    ]), []);

    const uncoveredAssetCols = useMemo(() => createColumns<any>([
        {
            accessorKey: 'name',
            header: 'Asset',
            cell: ({ getValue }: any) => (
                <span className="font-medium text-content-emphasis">{getValue()}</span>
            ),
        },
        {
            accessorKey: 'type',
            header: 'Type',
            cell: ({ getValue }: any) => (
                <span className="badge badge-info">{String(getValue()).replace(/_/g, ' ')}</span>
            ),
        },
        {
            accessorKey: 'criticality',
            header: 'Criticality',
            cell: ({ getValue }: any) => (
                <span className={`badge ${critBadge(getValue())}`}>{getValue()}</span>
            ),
        },
    ]), []);

    return (
        <>
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link
                        href={tenantHref('/assets')}
                        className="text-content-muted hover:text-content-emphasis transition"
                        id="coverage-back-link"
                        aria-label="Back to assets"
                    >
                        <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-content-emphasis" id="coverage-heading">
                            Coverage Dashboard
                        </h1>
                        <p className="text-content-muted text-sm">
                            How your assets are protected by controls and what risks remain unmitigated
                        </p>
                    </div>
                </div>
            </div>

            {/* ── KPI Strip: 3 Coverage Donuts ────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="coverage-kpi-strip">
                <CoverageKpiCard
                    id="kpi-assets-covered"
                    icon={<Cpu className="w-5 h-5" />}
                    label="Assets Protected"
                    pct={data.assetsWithControlsPct}
                    covered={data.assetsWithControlsCount}
                    total={data.totalAssets}
                    subtitle={`${data.assetsWithControlsCount} of ${data.totalAssets} assets linked to controls`}
                />
                <CoverageKpiCard
                    id="kpi-risks-mitigated"
                    icon={<AlertTriangle className="w-5 h-5" />}
                    label="Risks Mitigated"
                    pct={data.risksWithControlsPct}
                    covered={data.risksWithControlsCount}
                    total={data.totalRisks}
                    subtitle={`${data.risksWithControlsCount} of ${data.totalRisks} risks linked to controls`}
                />
                <CoverageKpiCard
                    id="kpi-controls-utilized"
                    icon={<ShieldCheck className="w-5 h-5" />}
                    label="Controls Utilized"
                    pct={data.controlsWithRisksPct}
                    covered={data.controlsWithRisksCount}
                    total={data.totalControls}
                    subtitle={`${data.controlsWithRisksCount} of ${data.totalControls} controls linked to risks`}
                />
            </div>

            {/* ── Summary Bar ─────────────────────────────────────── */}
            <div className="glass-card p-5" id="coverage-summary-bar">
                <h3 className="text-sm font-semibold text-content-emphasis mb-4">Overall Coverage</h3>
                <div className="space-y-3">
                    <CoverageBar
                        label="Asset Protection"
                        pct={data.assetsWithControlsPct}
                        detail={`${data.assetsWithControlsCount}/${data.totalAssets}`}
                    />
                    <CoverageBar
                        label="Risk Mitigation"
                        pct={data.risksWithControlsPct}
                        detail={`${data.risksWithControlsCount}/${data.totalRisks}`}
                    />
                    <CoverageBar
                        label="Control Utilization"
                        pct={data.controlsWithRisksPct}
                        detail={`${data.controlsWithRisksCount}/${data.totalControls}`}
                    />
                </div>
            </div>

            {/* ── Tables: Gaps ─────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Uncovered Critical Assets */}
                <div className="glass-card p-5" id="uncovered-assets-section">
                    <div className="flex items-center gap-2 mb-4">
                        <Cpu className="w-4 h-4 text-content-error" />
                        <h3 className="text-sm font-semibold text-content-emphasis">
                            Uncovered Critical Assets
                        </h3>
                        {data.uncoveredCriticalAssets.length > 0 && (
                            <span className="badge badge-danger text-xs ml-auto">
                                {data.uncoveredCriticalAssets.length}
                            </span>
                        )}
                    </div>
                    <DataTable
                        data={data.uncoveredCriticalAssets}
                        columns={uncoveredAssetCols}
                        getRowId={(a: any) => a.id}
                        onRowClick={(row) => window.location.href = tenantHref(`/assets/${row.original.id}`)}
                        emptyState="All critical assets are covered by controls"
                        resourceName={(p) => p ? 'assets' : 'asset'}
                        data-testid="uncovered-assets-table"
                    />
                </div>

                {/* Unmapped Risks */}
                <div className="glass-card p-5" id="unmapped-risks-section">
                    <div className="flex items-center gap-2 mb-4">
                        <AlertTriangle className="w-4 h-4 text-content-warning" />
                        <h3 className="text-sm font-semibold text-content-emphasis">
                            Unmapped Risks
                        </h3>
                        {data.unmappedRisks.length > 0 && (
                            <span className="badge badge-warning text-xs ml-auto">
                                {data.unmappedRisks.length}
                            </span>
                        )}
                    </div>
                    <DataTable
                        data={data.unmappedRisks}
                        columns={unmappedRiskCols}
                        getRowId={(r: any) => r.id}
                        onRowClick={(row) => window.location.href = tenantHref(`/risks/${row.original.id}`)}
                        emptyState="All risks are mitigated by controls"
                        resourceName={(p) => p ? 'risks' : 'risk'}
                        data-testid="unmapped-risks-table"
                    />
                </div>
            </div>

            {/* ── Hot Controls ─────────────────────────────────────── */}
            {data.hotControls.length > 0 && (
                <div className="glass-card p-5" id="hot-controls-section">
                    <div className="flex items-center gap-2 mb-4">
                        <Flame className="w-4 h-4 text-orange-400" />
                        <h3 className="text-sm font-semibold text-content-emphasis">
                            Top Controls by Risk Coverage
                        </h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        {data.hotControls.map((ctrl, idx) => (
                            <Link
                                key={ctrl.id}
                                href={tenantHref(`/controls/${ctrl.id}`)}
                                className="glass-card p-4 hover:scale-[1.03] transition-transform group cursor-pointer"
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`
                                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                                        ${idx === 0 ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-content-emphasis' :
                                          idx === 1 ? 'bg-gradient-to-r from-content-muted to-content-subtle text-content-emphasis' :
                                          'bg-bg-elevated text-content-default'}
                                    `}>
                                        {idx + 1}
                                    </span>
                                    {ctrl.code && (
                                        <span className="text-xs font-mono text-[var(--brand-default)]">{ctrl.code}</span>
                                    )}
                                </div>
                                <p className="text-sm font-medium text-content-emphasis group-hover:text-[var(--brand-muted)] transition-colors line-clamp-2">
                                    {ctrl.name}
                                </p>
                                <p className="text-xs text-content-muted mt-1">
                                    Mitigates <span className="text-content-emphasis font-semibold">{ctrl.riskCount}</span> risk{ctrl.riskCount !== 1 ? 's' : ''}
                                </p>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Sub-components ─────────────────────────────────────────────────

function CoverageKpiCard({
    id,
    icon,
    label,
    pct,
    covered,
    total,
    subtitle,
}: {
    id: string;
    icon: React.ReactNode;
    label: string;
    pct: number;
    covered: number;
    total: number;
    subtitle: string;
}) {
    const color = pctColor(pct);
    const gradientClass = pctGradient(pct);

    return (
        <div id={id} className="glass-card p-5 hover:scale-[1.02] transition-transform">
            <div className="flex items-center gap-2 mb-3">
                <span className="text-content-muted">{icon}</span>
                <span className="text-xs text-content-muted uppercase tracking-wide font-medium">
                    {label}
                </span>
            </div>

            <div className="flex items-center gap-5">
                <DonutChart
                    segments={[
                        { label: 'Covered', value: covered, color },
                        { label: 'Uncovered', value: Math.max(0, total - covered), color: '#334155' },
                    ]}
                    size={100}
                    strokeWidth={14}
                    centerLabel={`${pct}%`}
                    centerSub=""
                    showLegend={false}
                />
                <div className="flex-1 min-w-0">
                    <p className={`text-3xl font-bold bg-gradient-to-r ${gradientClass} bg-clip-text text-transparent`}>
                        {pct}%
                    </p>
                    <p className="text-xs text-content-subtle mt-1">{subtitle}</p>
                </div>
            </div>
        </div>
    );
}

function CoverageBar({
    label,
    pct,
    detail,
}: {
    label: string;
    pct: number;
    detail: string;
}) {
    const textClass = pctTextClass(pct);
    // Epic 59 — pick ProgressBar variant by the same score bands the
    // inline Tailwind class list used. Light-mode compatible via
    // token-backed variant colours.
    const variant = pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error';

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-content-muted">{label}</span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-content-subtle">{detail}</span>
                    <span className={`text-xs font-semibold ${textClass}`}>{pct}%</span>
                </div>
            </div>
            <ProgressBar
                value={Math.min(pct, 100)}
                size="md"
                variant={variant}
                aria-label={`${label} coverage`}
            />
        </div>
    );
}
