'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Paperclip } from 'lucide-react';

import { ListPageShell } from '@/components/layout/ListPageShell';
import { DataTable, createColumns } from '@/components/ui/table';
import { TableEmptyState } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { useCursorPagination } from '@/components/ui/hooks';
import { formatDate } from '@/lib/format-date';
import type { OverdueEvidenceRow } from '@/app-layer/schemas/portfolio';
import { Heading } from '@/components/ui/typography';

interface Props {
    rows: OverdueEvidenceRow[];
    nextCursor?: string | null;
    orgSlug?: string;
}

const STATUS_VARIANTS: Record<OverdueEvidenceRow['status'], 'warning' | 'info' | 'error'> = {
    DRAFT: 'warning',
    SUBMITTED: 'info',
    REJECTED: 'error',
};

function OverdueBadge({ days }: { days: number }) {
    // 30+ days → critical, 7+ → warning, otherwise pending.
    const variant = days >= 30 ? 'error' : days >= 7 ? 'warning' : 'warning';
    return (
        <StatusBadge variant={variant}>
            {days}d overdue
        </StatusBadge>
    );
}

export function EvidenceTable({ rows: initialRows, nextCursor: initialNextCursor, orgSlug }: Props) {
    const [sortBy, setSortBy] = useState<string>('daysOverdue');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    // Epic E — Load-more accumulator. See ControlsTable for design.
    const pagination = useCursorPagination<OverdueEvidenceRow>({
        initialRows,
        initialNextCursor: initialNextCursor ?? null,
        fetchUrl: (cursor) =>
            `/api/org/${orgSlug ?? ''}/portfolio?view=evidence&cursor=${encodeURIComponent(cursor)}`,
    });

    const sorted = useMemo(() => {
        const copy = [...pagination.rows];
        copy.sort((a, b) => {
            const dir = sortOrder === 'asc' ? 1 : -1;
            switch (sortBy) {
                case 'tenantName':
                    return dir * a.tenantName.localeCompare(b.tenantName);
                case 'title':
                    return dir * a.title.localeCompare(b.title);
                case 'status':
                    return dir * a.status.localeCompare(b.status);
                case 'nextReviewDate':
                    return dir * (new Date(a.nextReviewDate).getTime() - new Date(b.nextReviewDate).getTime());
                case 'daysOverdue':
                default:
                    return dir * (a.daysOverdue - b.daysOverdue) || a.tenantName.localeCompare(b.tenantName);
            }
        });
        return copy;
    }, [pagination.rows, sortBy, sortOrder]);

    const columns = useMemo(
        () =>
            createColumns<OverdueEvidenceRow>([
                {
                    id: 'tenantName',
                    header: 'Tenant',
                    cell: ({ row }) => (
                        <span
                            className="text-xs font-medium text-content-muted"
                            data-testid={`org-evidence-tenant-${row.original.tenantSlug}`}
                        >
                            {row.original.tenantName}
                        </span>
                    ),
                },
                {
                    id: 'title',
                    header: 'Evidence',
                    cell: ({ row }) => (
                        <Link
                            href={row.original.drillDownUrl}
                            className="font-medium text-content-emphasis hover:text-content-info hover:underline"
                            data-testid={`org-evidence-link-${row.original.evidenceId}`}
                        >
                            {row.original.title}
                        </Link>
                    ),
                },
                {
                    id: 'daysOverdue',
                    header: 'Overdue',
                    cell: ({ row }) => <OverdueBadge days={row.original.daysOverdue} />,
                },
                {
                    id: 'status',
                    header: 'Status',
                    cell: ({ row }) => (
                        <StatusBadge variant={STATUS_VARIANTS[row.original.status]}>
                            {row.original.status}
                        </StatusBadge>
                    ),
                },
                {
                    id: 'nextReviewDate',
                    header: 'Review due',
                    cell: ({ row }) => (
                        <span className="text-xs text-content-subtle tabular-nums">
                            {formatDate(row.original.nextReviewDate)}
                        </span>
                    ),
                },
            ]),
        [],
    );

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <div>
                    <Heading level={1}>
                        Overdue Evidence
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        {pagination.rows.length} evidence item{pagination.rows.length === 1 ? '' : 's'} past review across the portfolio
                        {pagination.hasMore ? ' (more available)' : ''}
                    </p>
                </div>
            </ListPageShell.Header>
            <ListPageShell.Body>
                <DataTable<OverdueEvidenceRow>
                    fillBody
                    data={sorted}
                    columns={columns}
                    getRowId={(r) => r.evidenceId}
                    sortableColumns={['tenantName', 'title', 'daysOverdue', 'status', 'nextReviewDate']}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(p) => {
                        if (p.sortBy) setSortBy(p.sortBy);
                        if (p.sortOrder) setSortOrder(p.sortOrder);
                    }}
                    resourceName={(plural) => (plural ? 'evidence items' : 'evidence item')}
                    emptyState={
                        <TableEmptyState
                            title="No overdue evidence"
                            description="Every non-approved evidence item is within its review window across this organization's tenants."
                            icon={<Paperclip className="size-10" />}
                        />
                    }
                    data-testid="org-evidence-table"
                />
                {pagination.hasMore && orgSlug && (
                    <div className="flex flex-col items-center gap-tight pt-3">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            data-testid="org-evidence-load-more"
                            onClick={() => {
                                void pagination.loadMore();
                            }}
                            disabled={pagination.loading}
                        >
                            {pagination.loading ? 'Loading…' : 'Load more evidence'}
                        </Button>
                        {pagination.error && (
                            <span
                                className="text-content-error text-sm"
                                role="alert"
                                data-testid="org-evidence-load-error"
                            >
                                Failed to load more — please retry.
                            </span>
                        )}
                    </div>
                )}
            </ListPageShell.Body>
        </ListPageShell>
    );
}
