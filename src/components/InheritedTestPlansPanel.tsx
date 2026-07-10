'use client';

/**
 * Read-only test-plan list for Asset / Risk detail pages. Test plans
 * run on controls, so an asset/risk inherits them from its mapped
 * controls. This panel fetches the aggregated plans (each tagged with
 * its owning control + latest run) and renders them read-only.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DataTable, createColumns } from '@/components/ui/table';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineNotice } from '@/components/ui/inline-notice';
import { TimestampTooltip } from '@/components/ui/timestamp-tooltip';

interface ControlRef {
    id: string;
    code: string | null;
    annexId: string | null;
    name: string;
}
interface InheritedTestPlanRow {
    id: string;
    name: string;
    method: string;
    status: string;
    nextDueAt: string | null;
    control: ControlRef | null;
    runs?: Array<{ id: string; result: string | null; status: string; executedAt: string | null }>;
}

const RESULT_BADGE: Record<string, StatusBadgeVariant> = {
    PASS: 'success', FAIL: 'error', INCONCLUSIVE: 'warning',
};
const PLAN_STATUS_BADGE: Record<string, StatusBadgeVariant> = {
    ACTIVE: 'success', PAUSED: 'warning', ARCHIVED: 'neutral',
};

export function InheritedTestPlansPanel({
    endpoint,
    tenantHref,
    entityLabel,
}: {
    endpoint: string;
    tenantHref: (path: string) => string;
    entityLabel: string;
}) {
    const t = useTranslations('inherited.testPlans');
    const [rows, setRows] = useState<InheritedTestPlanRow[]>([]);
    const [loading, setLoading] = useState(true);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const res = await fetch(endpoint);
                const data = res.ok ? await res.json() : [];
                if (!cancelled) setRows(Array.isArray(data) ? data : []);
            } catch {
                if (!cancelled) setRows([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [endpoint]);

    const columns = createColumns<InheritedTestPlanRow>([
        {
            id: 'name',
            header: t('colTestPlan'),
            accessorFn: (r) => r.name,
            cell: ({ row }) => <span className="text-sm text-content-default">{row.original.name}</span>,
        },
        {
            accessorKey: 'method',
            header: t('colMethod'),
            cell: ({ getValue }) => <span className="text-xs text-content-muted">{getValue<string>()}</span>,
        },
        {
            id: 'status',
            header: t('colStatus'),
            cell: ({ row }) => (
                <StatusBadge variant={PLAN_STATUS_BADGE[row.original.status] || 'neutral'} size="sm">
                    {row.original.status}
                </StatusBadge>
            ),
        },
        {
            id: 'latest',
            header: t('colLatest'),
            cell: ({ row }) => {
                const latest = row.original.runs?.[0];
                if (!latest?.result) return <span className="text-xs text-content-subtle">—</span>;
                return (
                    <StatusBadge variant={RESULT_BADGE[latest.result] || 'neutral'} size="sm">
                        {latest.result}
                    </StatusBadge>
                );
            },
        },
        {
            id: 'control',
            header: t('colControl'),
            cell: ({ row }) =>
                row.original.control ? (
                    <TableTitleCell href={tenantHref(`/controls/${row.original.control.id}`)}>
                        {row.original.control.code || row.original.control.annexId || row.original.control.name}
                    </TableTitleCell>
                ) : (
                    <span className="text-xs text-content-subtle">—</span>
                ),
        },
        {
            id: 'nextDueAt',
            header: t('colNextDue'),
            cell: ({ row }) => (
                <TimestampTooltip date={row.original.nextDueAt} className="text-xs text-content-muted" />
            ),
        },
    ]);

    return (
        <div className="space-y-default">
            <InlineNotice variant="info">
                {t('notice', { entityLabel })}
            </InlineNotice>
            <DataTable<InheritedTestPlanRow>
                data={rows}
                columns={columns}
                loading={loading}
                getRowId={(r) => r.id}
                emptyState={
                    <EmptyState
                        size="sm"
                        variant="no-records"
                        title={t('emptyTitle')}
                        description={t('emptyDesc', { entityLabel })}
                    />
                }
            />
        </div>
    );
}
