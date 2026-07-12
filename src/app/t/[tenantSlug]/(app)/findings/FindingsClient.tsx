'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- Client component receiving server-rendered domain data; tanstack column callbacks; or library-boundary callbacks. Per-site narrowing requires generated DTOs / per-cell CellContext imports — out of scope for the lint cleanup PR. */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { ownerDisplayName } from '@/lib/owner-display';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TableTitleCell } from '@/components/ui/table-title-cell';
import { DataTable, createColumns, useColumnsDropdown, useBulkDelete } from '@/components/ui/table';
import { ListPageShell } from '@/components/layout/ListPageShell';
import type { CappedList } from '@/lib/list-backfill-cap';
import { TruncationBanner } from '@/components/ui/TruncationBanner';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Plus } from '@/components/ui/icons/nucleo';
import { CreateFindingModal } from './CreateFindingModal';

const SEV_BADGE: Record<string, StatusBadgeVariant> = { LOW: 'info', MEDIUM: 'warning', HIGH: 'error', CRITICAL: 'error' };
const STATUS_BADGE: Record<string, StatusBadgeVariant> = { OPEN: 'error', IN_PROGRESS: 'info', READY_FOR_VERIFICATION: 'warning', CLOSED: 'success' };

interface FindingsClientProps {

    initialFindings: any[];
    tenantSlug: string;
    permissions: {
        canRead: boolean;
        canWrite: boolean;
        canAdmin: boolean;
        canAudit: boolean;
        canExport: boolean;
    };
    translations: {
        dashboard: string;
        title: string;
        listDescription: string;
        open: string;
        newFinding: string;
        findingTitle: string;
        severity: string;
        type: string;
        owner: string;
        status: string;
        description: string;
        dueDate: string;
        createFinding: string;
        noFindings: string;
        low: string;
        medium: string;
        high: string;
        critical: string;
        nonconformity: string;
        observation: string;
        opportunity: string;
        inProgress: string;
        readyForVerification: string;
        closed: string;
        cancel: string;
        actions: string;
    };
}

/**
 * Client island for findings — handles create form and status updates.
 * Data is pre-fetched server-side and passed via props.
 */
export function FindingsClient({ initialFindings, tenantSlug, permissions, translations: t }: FindingsClientProps) {
    const [showForm, setShowForm] = useState(false);

    const apiUrl = (path: string) => `/api/t/${tenantSlug}${path}`;
    const queryClient = useQueryClient();

    // PR-5 — API returns `{ rows, truncated }`; SSR initial wraps
    // with `truncated: false` (SSR cap < backfill cap).
    const findingsQuery = useQuery<CappedList<any>>({
        queryKey: queryKeys.findings.list(tenantSlug),
        queryFn: async () => {
            const res = await fetch(apiUrl('/findings'));
            if (!res.ok) throw new Error('Failed to fetch findings');
            return res.json();
        },
        initialData: { rows: initialFindings, truncated: false },
    });
    const findings = findingsQuery.data?.rows ?? [];
    const truncated = findingsQuery.data?.truncated ?? false;

    const statusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: string, status: string }) => {
            const res = await fetch(apiUrl(`/findings/${id}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
            if (!res.ok) throw new Error('Failed to update status');
            return res.json();
        },

        onMutate: async ({ id, status }: { id: string; status: string }) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.findings.list(tenantSlug) });
            // PR-5 — cache value is now `CappedList<any>` not the bare array.
            const prev = queryClient.getQueryData<CappedList<any>>(queryKeys.findings.list(tenantSlug));
            if (prev) {
                queryClient.setQueryData<CappedList<any>>(
                    queryKeys.findings.list(tenantSlug),
                    {
                        ...prev,
                        rows: prev.rows.map((f: any) => (f.id === id ? { ...f, status } : f)),
                    },
                );
            }
            return { prev };
        },
        onError: (_err, _variables, context) => {
            if (context?.prev) {
                queryClient.setQueryData(queryKeys.findings.list(tenantSlug), context.prev);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.findings.list(tenantSlug) });
        }
    });

    const updateStatus = (id: string, status: string) => {
        statusMutation.mutate({ id, status });
    };

    // Bulk-delete via the table selection action-row.
    const { batchAction: findingBulkDelete, dialog: findingDeleteDialog } =
        useBulkDelete({
            entitySingular: 'finding',
            entityPlural: 'findings',
            onDelete: async (findingIds) => {
                const res = await fetch(apiUrl('/findings/bulk/delete'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ findingIds }),
                });
                if (!res.ok) throw new Error('Failed to delete findings');
                await queryClient.invalidateQueries({ queryKey: queryKeys.findings.list(tenantSlug) });
            },
        });

    const sevLabel = (sev: string) => {
        const map: Record<string, string> = { LOW: t.low, MEDIUM: t.medium, HIGH: t.high, CRITICAL: t.critical };
        return map[sev] || sev;
    };

    const typeLabel = (type: string) => {
        const map: Record<string, string> = { NONCONFORMITY: t.nonconformity, OBSERVATION: t.observation, OPPORTUNITY: t.opportunity };
        return map[type] || type;
    };

    const statusLabel = (status: string) => {
        const map: Record<string, string> = { OPEN: t.open, IN_PROGRESS: t.inProgress, READY_FOR_VERIFICATION: t.readyForVerification, CLOSED: t.closed };
        return map[status] || status;
    };

    // R10-PR11 — column-visibility gear.
    const findingColumnList = useMemo(
        () => [
            { id: 'title', label: 'Title' },
            { id: 'severity', label: 'Severity' },
            { id: 'type', label: 'Type' },
            { id: 'owner', label: 'Owner' },
            { id: 'status', label: 'Status' },
        ],
        [],
    );
    const {
        columnVisibility,
        setColumnVisibility,
        orderColumns,
        dropdown: columnsDropdown,
    } = useColumnsDropdown({
        storageKey: 'inflect:col-vis:findings',
        columns: findingColumnList,
    });


    const findingColumns = useMemo(() => createColumns<any>([
        {
            accessorKey: 'title',
            header: t.findingTitle,
            meta: { mobileCard: { slot: 'title' } },

            cell: ({ getValue }: any) => <TableTitleCell>{getValue()}</TableTitleCell>,
        },
        {
            accessorKey: 'severity',
            header: t.severity,
            meta: { mobileCard: { slot: 'status' } },

            cell: ({ row }: any) => <StatusBadge variant={SEV_BADGE[row.original.severity]}>{sevLabel(row.original.severity)}</StatusBadge>,
        },
        {
            accessorKey: 'type',
            header: t.type,
            meta: { mobileCard: { slot: 'subtitle' } },

            cell: ({ row }: any) => <span className="text-xs">{typeLabel(row.original.type)}</span>,
        },
        {
            id: 'owner',
            header: t.owner,
            meta: { mobileCard: { slot: 'meta' } },

            // Prefer the assignee (the canonical owner relation); fall
            // back to the legacy free-text `owner` for older findings.
            accessorFn: (f: any) =>
                ownerDisplayName(f.assignee?.name, f.assignee?.email) ?? f.owner ?? '—',

            cell: ({ getValue }: any) => <span className="text-xs">{getValue()}</span>,
        },
        {
            accessorKey: 'status',
            header: t.status,
            meta: { mobileCard: { slot: 'meta' } },

            // R8-PR5 — secondary (workflow) badge demotes to `tone="subtle"`
            // so the loud severity badge in the prior column reads as the
            // primary state signal. Keeps the workflow tone visible without
            // creating a two-loud-badge wall per row.
            cell: ({ row }: any) => <StatusBadge tone="subtle" variant={STATUS_BADGE[row.original.status]}>{statusLabel(row.original.status)}</StatusBadge>,
        },
        {
            id: 'actions',
            header: t.actions,
            enableHiding: false,

            cell: ({ row }: any) => {
                const f = row.original;
                return (
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {f.status === 'OPEN' && <Button variant="secondary" size="sm" onClick={() => updateStatus(f.id, 'IN_PROGRESS')}>{t.inProgress}</Button>}
                        {f.status === 'IN_PROGRESS' && <Button variant="secondary" size="sm" onClick={() => updateStatus(f.id, 'READY_FOR_VERIFICATION')}>{t.readyForVerification}</Button>}
                        {f.status === 'READY_FOR_VERIFICATION' && <Button variant="secondary" size="sm" onClick={() => updateStatus(f.id, 'CLOSED')}>{t.closed}</Button>}
                    </div>
                );
            },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ]), [t]);

    return (
        <ListPageShell className="gap-section">
            <ListPageShell.Header>
                <PageHeader
                    breadcrumbs={[
                        { label: t.dashboard, href: `/t/${tenantSlug}/dashboard` },
                        { label: t.title },
                    ]}
                    title={t.title}
                    description={t.listDescription || undefined}
                    actions={
                        <Button variant="primary" icon={<Plus className="-ml-0.5 -mr-2.5" />} onClick={() => setShowForm(!showForm)}>{t.newFinding}</Button>
                    }
                />
            </ListPageShell.Header>

            <CreateFindingModal
                open={showForm}
                setOpen={setShowForm}
                tenantSlug={tenantSlug}
                apiUrl={apiUrl}
            />

            <ListPageShell.Body>
                <TruncationBanner truncated={truncated} />
                <div className="flex justify-end mb-tight">
                    {columnsDropdown}
                </div>
                <DataTable
                    fillBody
                    mobileFallback="card"
                    data={findings}
                    columns={orderColumns(findingColumns)}
                    getRowId={(f: any) => f.id}
                    batchActions={permissions.canAdmin ? [findingBulkDelete] : undefined}
                    columnVisibility={columnVisibility}
                    onColumnVisibilityChange={setColumnVisibility}
                    emptyState={
                        <EmptyState
                            size="sm"
                            variant="no-records"
                            title={t.noFindings}
                            description="Findings capture nonconformities, observations, and opportunities — what an audit surfaced and what needs follow-up."
                        />
                    }
                    resourceName={(p) => p ? 'findings' : 'finding'}
                    data-testid="findings-table"
                />
            </ListPageShell.Body>
            {findingDeleteDialog}
        </ListPageShell>
    );
}
