'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Client component receiving server-rendered domain data; tanstack column callbacks; or library-boundary callbacks. Per-site narrowing requires generated DTOs / per-cell CellContext imports — out of scope for the lint cleanup PR. */
import { useState, useMemo } from 'react';
import { SoAClient } from './soa/SoAClient';
import { PdfExportButton } from '@/components/PdfExportButton';
import { RequirePermission } from '@/components/require-permission';
import { UpgradeGate } from '@/components/UpgradeGate';
import type { SoAReportDTO } from '@/lib/dto/soa';
import { DataTable, createColumns } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/typography';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface ControlOption {
    id: string;
    code: string | null;
    name: string;
    status: string;
}

interface ReportsClientProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const [tab, setTab] = useState<'soa' | 'risk'>('soa');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const downloadCSV = (rows: any[], filename: string) => {
        if (!rows.length) return;
        const headers = Object.keys(rows[0]);
        const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const riskColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: t.risk,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="font-medium text-sm text-content-emphasis">{getValue()}</span>,
        },
        {
            accessorKey: 'asset',
            header: t.asset,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            accessorKey: 'threat',
            header: t.threat,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs text-content-muted">{getValue()}</span>,
        },
        {
            id: 'lxi',
            header: 'L×I',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accessorFn: (r: any) => `${r.likelihood}×${r.impact}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            accessorKey: 'score',
            header: t.score,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="font-bold">{getValue()}</span>,
        },
        {
            accessorKey: 'treatment',
            header: t.treatment,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            accessorKey: 'owner',
            header: t.owner,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            id: 'controls',
            header: t.controls,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accessorFn: (r: any) => r.controls || '—',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cell: ({ getValue }: any) => <span className="text-xs text-content-muted">{getValue()}</span>,
        },
    ]), [t]);

    return (
        <ListPageShell className="gap-default">
            <ListPageShell.Header>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-compact">
                    <div>
                        <Breadcrumbs
                            items={[
                                { label: 'Dashboard', href: `/t/${tenantSlug}/dashboard` },
                                { label: t.title },
                            ]}
                            className="mb-1"
                        />
                        <Heading level={1} id="reports-heading">{t.title}</Heading>
                        <p className="text-content-muted text-sm">{t.subtitle}</p>
                    </div>
                    <RequirePermission resource="reports" action="export">
                        <div className="flex flex-wrap gap-tight">
                            <Button variant="secondary" onClick={() => downloadCSV(data.riskRegister, 'risk-register.csv')} id="export-risks-btn">{t.exportRisks}</Button>
                            <UpgradeGate feature="PDF_EXPORTS">
                                <PdfExportButton
                                    tenantSlug={tenantSlug}
                                    reportType="RISK_REGISTER"
                                    label="Risk Register PDF"
                                    allowSave={canEdit}
                                />
                            </UpgradeGate>
                        </div>
                    </RequirePermission>
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters>
                {/* Epic 60 — ToggleGroup with `id` on each option to
                    preserve `#soa-tab-btn` / `#risk-tab-btn` E2E selectors
                    used by tests/e2e/reporting.spec.ts. */}
                <ToggleGroup
                    ariaLabel="Report"
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
                        data={data.riskRegister}
                        columns={riskColumns}
                        getRowId={(r: any) => r.id}
                        emptyState="No risks in the register"
                        resourceName={(p) => p ? 'risks' : 'risk'}
                        data-testid="risk-table"
                    />
                )}
            </ListPageShell.Body>
        </ListPageShell>
    );
}
