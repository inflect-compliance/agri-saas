'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Client component receiving server-rendered domain data; tanstack column callbacks; or library-boundary callbacks. Per-site narrowing requires generated DTOs / per-cell CellContext imports — out of scope for the lint cleanup PR. */
import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { SoAClient } from './soa/SoAClient';
import { PdfExportButton } from '@/components/PdfExportButton';
import { RequirePermission } from '@/components/require-permission';
import { UpgradeGate } from '@/components/UpgradeGate';
import type { SoAReportDTO } from '@/lib/dto/soa';
import { DataTable, createColumns } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

interface ControlOption {
    id: string;
    code: string | null;
    name: string;
    status: string;
}

interface ReportsClientProps {

    data: { soa: any[]; riskRegister: any[] };
    soaReport: SoAReportDTO;
    controls: ControlOption[];
    tenantSlug: string;
    canEdit: boolean;
    translations: Record<string, string>;
}

/**
 * Client island for reports — tab toggle between full SoA and risk register.
 */
export function ReportsClient({ data, soaReport, controls, tenantSlug, canEdit, translations: t }: ReportsClientProps) {
    const tt = useTranslations('reports');
    const [tab, setTab] = useState<'soa' | 'risk'>('soa');


    const downloadCSV = (rows: any[], filename: string) => {
        if (!rows.length) return;
        const headers = Object.keys(rows[0]);
        const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    };

    // R13-PR8 — cell `text-xs` overrides removed so the risk
    // register renders at the DataTable primitive's default
    // `text-sm leading-6`, matching Controls.

    const riskColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: t.risk,
            meta: { mobileCard: { slot: 'title' } },

            cell: ({ getValue }: any) => <span className="font-medium text-content-emphasis">{getValue()}</span>,
        },
        {
            accessorKey: 'asset',
            header: t.asset,
            meta: { mobileCard: { slot: 'subtitle' } },

            cell: ({ getValue }: any) => <span>{getValue()}</span>,
        },
        {
            accessorKey: 'threat',
            header: t.threat,

            cell: ({ getValue }: any) => <span className="text-content-muted">{getValue()}</span>,
        },
        {
            id: 'lxi',
            header: 'L×I',

            accessorFn: (r: any) => `${r.likelihood}×${r.impact}`,

            cell: ({ getValue }: any) => <span>{getValue()}</span>,
        },
        {
            accessorKey: 'score',
            header: t.score,
            meta: { mobileCard: { slot: 'meta', label: t.score } },

            cell: ({ getValue }: any) => <span className="font-bold">{getValue()}</span>,
        },
        {
            accessorKey: 'treatment',
            header: t.treatment,
            meta: { mobileCard: { slot: 'meta', label: t.treatment } },

            cell: ({ getValue }: any) => <span>{getValue()}</span>,
        },
        {
            accessorKey: 'owner',
            header: t.owner,
            meta: { mobileCard: { slot: 'meta', label: t.owner } },

            cell: ({ getValue }: any) => <span>{getValue()}</span>,
        },
        {
            id: 'controls',
            header: t.controls,

            accessorFn: (r: any) => r.controls || '—',

            cell: ({ getValue }: any) => <span className="text-content-muted">{getValue()}</span>,
        },
    ]), [t]);

    return (
        <ListPageShell className="gap-default">
            <ListPageShell.Header>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-compact">
                    <div>
                        <PageBreadcrumbs
                            items={[
                                { label: tt('breadcrumbDashboard'), href: `/t/${tenantSlug}/dashboard` },
                                { label: t.title },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1} id="reports-heading">{t.title}</Heading>
                        <p className="text-sm text-content-muted mt-1">{t.subtitle}</p>
                    </div>
                    {/* Roadmap-2 PR-12 — tab-aware exports.
                        SoA tab gets SoA-specific exports
                        (CSV + Audit Readiness PDF + Gap
                        Analysis PDF). Risk Register tab gets
                        the Risk Register exports. The buttons
                        live ONCE in the page header — they used
                        to live both here AND inside SoAClient,
                        which read as a doubled chrome. */}
                    <RequirePermission resource="reports" action="export">
                        <div className="flex flex-wrap gap-tight">
                            {tab === 'soa' ? (
                                <>
                                    <a
                                        href={`/api/t/${tenantSlug}/reports/soa/export.csv`}
                                        className={buttonVariants({ variant: 'secondary' })}
                                        download
                                        id="export-soa-btn"
                                    >
                                        <Download className="w-3.5 h-3.5" /> {tt('exportCsv')}
                                    </a>
                                    <UpgradeGate feature="PDF_EXPORTS">
                                        <PdfExportButton
                                            tenantSlug={tenantSlug}
                                            reportType="AUDIT_READINESS"
                                            label={tt('auditReadiness')}
                                            allowSave={canEdit}
                                        />
                                    </UpgradeGate>
                                    <UpgradeGate feature="PDF_EXPORTS">
                                        <PdfExportButton
                                            tenantSlug={tenantSlug}
                                            reportType="GAP_ANALYSIS"
                                            label={tt('gapAnalysis')}
                                            allowSave={canEdit}
                                        />
                                    </UpgradeGate>
                                </>
                            ) : (
                                <>
                                    <Button variant="secondary" onClick={() => downloadCSV(data.riskRegister, 'risk-register.csv')} id="export-risks-btn">{t.exportRisks}</Button>
                                    <UpgradeGate feature="PDF_EXPORTS">
                                        <PdfExportButton
                                            tenantSlug={tenantSlug}
                                            reportType="RISK_REGISTER"
                                            label={tt('riskRegister')}
                                            allowSave={canEdit}
                                        />
                                    </UpgradeGate>
                                </>
                            )}
                        </div>
                    </RequirePermission>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters>
                {/* Epic 60 — ToggleGroup with `id` on each option to
                    preserve `#soa-tab-btn` / `#risk-tab-btn` E2E selectors
                    used by tests/e2e/reporting.spec.ts. */}
                <ToggleGroup
                    ariaLabel={tt('reportAria')}
                    options={[
                        { value: 'soa', label: t.soa, id: 'soa-tab-btn' },
                        { value: 'risk', label: t.riskRegister, id: 'risk-tab-btn' },
                    ]}
                    selected={tab}
                    selectAction={(v) => setTab(v as 'soa' | 'risk')}
                />
            </ListPageShell.Filters>

            <ListPageShell.Body>
                {tab === 'soa' ? (
                    <SoAClient
                        report={soaReport}
                        controls={controls}
                        tenantSlug={tenantSlug}
                        canEdit={canEdit}
                    />
                ) : (
                    <DataTable
                        fillBody
                        mobileFallback="card"
                        data={data.riskRegister}
                        columns={riskColumns}
                        getRowId={(r: any) => r.id}
                        emptyState={tt('riskEmpty')}
                        resourceName={(p) => p ? tt('resourceRisks') : tt('resourceRisk')}
                        data-testid="risk-table"
                    />
                )}
            </ListPageShell.Body>
        </ListPageShell>
    );
}
