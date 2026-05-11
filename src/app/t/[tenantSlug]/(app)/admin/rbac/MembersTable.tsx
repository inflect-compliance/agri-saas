'use client';

import { useMemo } from 'react';
import { DataTable } from '@/components/ui/table';
import type { ColumnDef } from '@tanstack/react-table';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { formatDate } from '@/lib/format-date';

export interface MembersTableRow {
    id: string;
    name: string | null;
    email: string;
    role: string;
    createdAtIso: string;
}

interface MembersTableProps {
    members: MembersTableRow[];
}

const ROLE_TONE: Record<string, StatusBadgeVariant> = {
    OWNER: 'error',
    ADMIN: 'error',
    EDITOR: 'info',
    AUDITOR: 'warning',
    READER: 'neutral',
};

export function MembersTable({ members }: MembersTableProps) {
    const columns = useMemo<ColumnDef<MembersTableRow>[]>(
        () => [
            {
                id: 'name',
                header: 'Name',
                accessorKey: 'name',
                cell: ({ getValue }) => (
                    <span className="text-sm font-medium text-content-emphasis">
                        {(getValue() as string | null) || '—'}
                    </span>
                ),
            },
            {
                id: 'email',
                header: 'Email',
                accessorKey: 'email',
                cell: ({ getValue }) => (
                    <span className="text-xs text-content-muted">
                        {getValue() as string}
                    </span>
                ),
            },
            {
                id: 'role',
                header: 'Role',
                accessorKey: 'role',
                cell: ({ getValue }) => {
                    const role = getValue() as string;
                    return (
                        <StatusBadge variant={ROLE_TONE[role] ?? 'neutral'}>
                            {role}
                        </StatusBadge>
                    );
                },
            },
            {
                id: 'joined',
                header: 'Joined',
                accessorKey: 'createdAtIso',
                cell: ({ getValue }) => (
                    <span className="text-xs text-content-subtle whitespace-nowrap">
                        {formatDate(getValue() as string)}
                    </span>
                ),
            },
        ],
        [],
    );

    return (
        <DataTable
            data={members}
            columns={columns}
            getRowId={(m) => m.id}
            emptyState="No members yet."
            resourceName={(p) => (p ? 'members' : 'member')}
            data-testid="rbac-members-table"
        />
    );
}
