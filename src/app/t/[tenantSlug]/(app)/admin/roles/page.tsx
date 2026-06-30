'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Custom Roles admin — Epic 48 DataTable migration.
 *
 * Replaces the hand-rolled `<table className="data-table">`
 * with the shared <DataTable> + <ListPageShell> primitives.
 *
 * The previous markup expanded a row inline when editing a role
 * (the row's `<td colSpan={6}>` swapped to a <RoleForm>).
 * That doesn't fit the row-per-record model DataTable assumes,
 * so the edit form now renders ABOVE the table — same place +
 * shape as the existing create form. The selected row is hidden
 * from the table while editing so the user has one obvious focus
 * surface, not two competing ones.
 *
 * Stable IDs preserved: roles-table-card, roles-table,
 * create-role-form, edit-role-form (new), create-role-btn,
 * role-name-input, role-base-select, role-description-input,
 * toggle-permissions-btn, role-submit-btn, edit-role-${id},
 * delete-role-${id}, perm-${resource}-${action},
 * preset-${role}, roles-error, roles-success.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, cardVariants } from '@/components/ui/card';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import { getPermissionsForRole, type PermissionSet } from '@/lib/permissions';
import {
    Shield, Pencil, Trash2, Check,
    ChevronDown, ChevronUp, Users,
} from 'lucide-react';
import type { Role } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { DataTable, createColumns, useBulkDelete } from '@/components/ui/table';
import { InlineNotice } from '@/components/ui/inline-notice';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import { Heading, Eyebrow } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';
import { cn } from '@/lib/cn';

// ─── Types ───

interface CustomRole {
    id: string;
    name: string;
    description: string | null;
    baseRole: Role;
    permissionsJson: PermissionSet;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    _count: { memberships: number };
}

// ─── Permission Schema (must match src/lib/permissions.ts PERMISSION_SCHEMA) ───

const PERMISSION_SCHEMA: Record<keyof PermissionSet, string[]> = {
    controls: ['view', 'create', 'edit'],
    evidence: ['view', 'upload', 'edit', 'download'],
    policies: ['view', 'create', 'edit', 'approve'],
    tasks: ['view', 'create', 'edit', 'assign'],
    risks: ['view', 'create', 'edit'],
    vendors: ['view', 'create', 'edit'],
    tests: ['view', 'create', 'execute'],
    frameworks: ['view', 'install'],
    audits: ['view', 'manage', 'freeze', 'share'],
    reports: ['view', 'export'],
    admin: ['view', 'manage', 'members', 'sso', 'scim'],
};

const RESOURCE_LABELS: Record<string, string> = {
    controls: 'Controls',
    evidence: 'Evidence',
    policies: 'Policies',
    tasks: 'Tasks',
    risks: 'Risks',
    vendors: 'Vendors',
    tests: 'Tests',
    frameworks: 'Frameworks',
    audits: 'Audits',
    reports: 'Reports',
    admin: 'Admin',
};

const BASE_ROLES: Role[] = ['ADMIN', 'EDITOR', 'AUDITOR', 'READER'];
const ROLE_COLORS: Record<string, StatusBadgeVariant> = {
    ADMIN: 'error',
    EDITOR: 'info',
    AUDITOR: 'warning',
    READER: 'neutral',
};
const BASE_ROLE_OPTIONS: ComboboxOption[] = BASE_ROLES.map(r => ({ value: r, label: r }));

// ─── Permission Grid Component ───

function PermissionGrid({
    permissions,
    onChange,
    readonly = false,
}: {
    permissions: PermissionSet;
    onChange: (p: PermissionSet) => void;
    readonly?: boolean;
}) {
    const toggle = (resource: keyof PermissionSet, action: string) => {
        if (readonly) return;
        const current = (permissions[resource] as Record<string, boolean>)[action];
        const updated = {
            ...permissions,
            [resource]: {
                ...permissions[resource],
                [action]: !current,
            },
        };
        onChange(updated);
    };

    const allActions = Array.from(
        new Set(Object.values(PERMISSION_SCHEMA).flat())
    );

    return (
        <div className="overflow-x-auto">
            <table className="data-table text-xs">
                <thead>
                    <tr>
                        <th className="sticky left-0 bg-bg-default/90 z-10 text-left">Resource</th>
                        {allActions.map((action) => (
                            <th key={action} className="text-center capitalize px-2">
                                {action}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {(Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]).map((resource) => {
                        const resourceActions = PERMISSION_SCHEMA[resource];
                        return (
                            <tr key={resource}>
                                <td className="sticky left-0 bg-bg-default/50 text-xs font-medium text-content-default">
                                    {RESOURCE_LABELS[resource]}
                                </td>
                                {allActions.map((action) => {
                                    const hasAction = resourceActions.includes(action);
                                    if (!hasAction) {
                                        return <td key={action} className="text-center"><span className="text-content-subtle">—</span></td>;
                                    }
                                    const granted = (permissions[resource] as Record<string, boolean>)[action] ?? false;
                                    return (
                                        <td key={action} className="text-center">
                                            <button
                                                type="button"
                                                onClick={() => toggle(resource, action)}
                                                disabled={readonly}
                                                className={`
                                                    inline-flex items-center justify-center w-5 h-5 rounded transition
                                                    ${granted
                                                        ? 'bg-bg-success text-content-success hover:bg-bg-success'
                                                        : 'bg-bg-elevated/50 text-content-subtle hover:bg-bg-muted'
                                                    }
                                                    ${readonly ? 'cursor-default' : 'cursor-pointer'}
                                                `}
                                                title={`${resource}.${action}: ${granted ? 'granted' : 'denied'}`}
                                                id={`perm-${resource}-${action}`}
                                            >
                                                {granted ? <Check size={10} /> : null}
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Role Form Component ───

function RoleForm({
    initial,
    onSubmit,
    onCancel,
    submitting,
    submitLabel,
}: {
    initial?: CustomRole;
    onSubmit: (data: { name: string; description: string; baseRole: Role; permissionsJson: PermissionSet }) => void;
    onCancel: () => void;
    submitting: boolean;
    submitLabel: string;
}) {
    const [name, setName] = useState(initial?.name ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [baseRole, setBaseRole] = useState<Role>(initial?.baseRole ?? 'READER');
    const [permissions, setPermissions] = useState<PermissionSet>(
        initial?.permissionsJson ?? getPermissionsForRole('READER'),
    );
    const [showGrid, setShowGrid] = useState(!!initial);

    const handleBaseRoleChange = (role: Role) => {
        setBaseRole(role);
        if (!initial) {
            setPermissions(getPermissionsForRole(role));
        }
    };

    return (
        <div className="space-y-default">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-default">
                <div>
                    <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                        Role Name *
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Compliance Lead"
                        className="input w-full"
                        maxLength={100}
                        id="role-name-input"
                    />
                </div>
                <div>
                    <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                        Base Role (fallback)
                    </label>
                    <Combobox
                        hideSearch
                        id="role-base-select"
                        selected={BASE_ROLE_OPTIONS.find(o => o.value === baseRole) ?? null}
                        setSelected={(opt) => { if (opt) handleBaseRoleChange(opt.value as Role); }}
                        options={BASE_ROLE_OPTIONS}
                        matchTriggerWidth
                    />
                    <p className="text-[10px] text-content-subtle mt-1">
                        Used for coarse authorization when custom permissions don&apos;t apply.
                    </p>
                </div>
            </div>

            <div>
                <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                    Description
                </label>
                <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional — describe what this role is for"
                    className="input w-full"
                    maxLength={500}
                    id="role-description-input"
                />
            </div>

            {/* Permission Grid */}
            <div>
                <button
                    type="button"
                    onClick={() => setShowGrid(!showGrid)}
                    className="flex items-center gap-1 text-sm text-[var(--brand-default)] hover:text-[var(--brand-muted)] transition"
                    id="toggle-permissions-btn"
                >
                    {showGrid ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showGrid ? 'Hide' : 'Show'} Permission Grid
                </button>
                {showGrid && (
                    <div className={cn(cardVariants({ density: 'compact' }), 'mt-3')}>
                        <div className="flex items-center justify-between mb-3">
                            <Eyebrow>Permissions</Eyebrow>
                            <div className="flex gap-1">
                                <span className="text-[10px] text-content-subtle">Preset from:</span>
                                {BASE_ROLES.map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setPermissions(getPermissionsForRole(r))}
                                        className="text-[10px] px-2 py-0.5 rounded bg-bg-elevated/50 text-content-default hover:bg-bg-muted/50 transition"
                                        id={`preset-${r}`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <PermissionGrid permissions={permissions} onChange={setPermissions} />
                    </div>
                )}
            </div>

            <div className="flex gap-tight pt-2">
                <Button
                    variant="primary"
                    type="button"
                    onClick={() => onSubmit({ name: name.trim(), description: description.trim(), baseRole, permissionsJson: permissions })}
                    disabled={submitting || !name.trim()}
                    loading={submitting}
                    id="role-submit-btn"
                >
                    {submitting ? 'Saving...' : submitLabel}
                </Button>
                <Button variant="secondary" type="button" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}

// ─── Main Page ───

export default function CustomRolesPage() {
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();

    const [roles, setRoles] = useState<CustomRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form state
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // ─── Data Fetching ───
    const fetchRoles = useCallback(async () => {
        try {
            const res = await fetch(apiUrl('/admin/roles'));
            if (res.ok) {
                const data = await res.json();
                setRoles(data.filter((r: CustomRole) => r.isActive));
            }
        } catch {
            setError('Failed to load custom roles');
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchRoles(); }, [fetchRoles]);

    // ─── Handlers ───
    async function handleCreate(data: { name: string; description: string; baseRole: Role; permissionsJson: PermissionSet }) {
        setError(null);
        setSuccess(null);
        setSubmitting(true);
        try {
            const res = await fetch(apiUrl('/admin/roles'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Create failed' }));
                setError(err.error?.message || err.error || err.message || 'Create failed');
                return;
            }
            setSuccess(`Custom role "${data.name}" created successfully.`);
            setShowCreate(false);
            await fetchRoles();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleUpdate(roleId: string, data: { name: string; description: string; baseRole: Role; permissionsJson: PermissionSet }) {
        setError(null);
        setSuccess(null);
        setSubmitting(true);
        try {
            const res = await fetch(apiUrl(`/admin/roles/${roleId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Update failed' }));
                setError(err.error?.message || err.error || err.message || 'Update failed');
                return;
            }
            setSuccess(`Custom role "${data.name}" updated successfully.`);
            setEditingId(null);
            await fetchRoles();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(role: CustomRole) {
        const memberWarning = role._count.memberships > 0
            ? `\n\n${role._count.memberships} member(s) will lose this custom role and fall back to their base role.`
            : '';
        if (!confirm(`Delete "${role.name}"?${memberWarning}`)) return;

        setError(null);
        setSuccess(null);
        try {
            const res = await fetch(apiUrl(`/admin/roles/${role.id}`), { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Delete failed' }));
                setError(err.error?.message || err.error || err.message || 'Delete failed');
                return;
            }
            const result = await res.json();
            setSuccess(`Deleted "${role.name}". ${result.membersCleared} member(s) reassigned to fallback.`);
            await fetchRoles();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    // ─── Bulk delete (selection action-row) ───
    // Mirrors the single delete: same `admin.manage`-gated endpoint, same
    // soft-delete + member-fallback semantics; the usecase is idempotent.
    const { batchAction: roleBulkAction, dialog: roleDeleteDialog } =
        useBulkDelete<CustomRole>({
            entitySingular: 'role',
            entityPlural: 'roles',
            onDelete: async (roleIds) => {
                const res = await fetch(apiUrl('/admin/roles/bulk/delete'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roleIds }),
                });
                if (!res.ok) throw new Error('Failed to delete roles');
                await fetchRoles();
            },
        });

    // ─── Permission summary for table display ───
    function countGranted(perms: PermissionSet): string {
        let granted = 0;
        let total = 0;
        for (const resource of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
            for (const action of PERMISSION_SCHEMA[resource]) {
                total++;
                if ((perms[resource] as Record<string, boolean>)[action]) granted++;
            }
        }
        return `${granted}/${total}`;
    }

    // ─── DataTable columns ───
    const editingRole = useMemo(
        () => (editingId ? roles.find((r) => r.id === editingId) ?? null : null),
        [editingId, roles],
    );
    // Hide the row currently being edited from the table — the
    // edit form above renders the full record, so showing it twice
    // would be visual noise.
    const visibleRoles = useMemo(
        () => (editingId ? roles.filter((r) => r.id !== editingId) : roles),
        [roles, editingId],
    );

    const roleColumns = useMemo(
        () => createColumns<CustomRole>([
            {
                id: 'name',
                header: 'Name',
                accessorKey: 'name',
                cell: ({ row }) => (
                    <span className="text-sm font-medium text-content-emphasis">{row.original.name}</span>
                ),
            },
            {
                id: 'baseRole',
                header: 'Base Role',
                accessorKey: 'baseRole',
                cell: ({ row }) => (
                    <StatusBadge variant={ROLE_COLORS[row.original.baseRole] || 'neutral'}>
                        {row.original.baseRole}
                    </StatusBadge>
                ),
            },
            {
                id: 'description',
                header: 'Description',
                accessorKey: 'description',
                cell: ({ row }) => (
                    <span className="text-content-muted truncate block max-w-xs">
                        {row.original.description || '—'}
                    </span>
                ),
            },
            {
                id: 'members',
                header: 'Members',
                accessorFn: (r) => r._count.memberships,
                cell: ({ row }) => (
                    <span className="flex items-center gap-1 text-content-default">
                        <Users className="w-3.5 h-3.5" />
                        {row.original._count.memberships}
                    </span>
                ),
            },
            {
                id: 'permissions',
                header: 'Permissions',
                accessorFn: (r) => countGranted(r.permissionsJson),
                cell: ({ row }) => (
                    <span className="text-content-muted font-mono">
                        {countGranted(row.original.permissionsJson)}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => {
                    const role = row.original;
                    return (
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                            <Tooltip content="Edit role">
                                <Button
                                    variant="secondary"
                                    size="xs"
                                    onClick={() => {
                                        setShowCreate(false);
                                        setEditingId(role.id);
                                    }}
                                    aria-label="Edit role"
                                    id={`edit-role-${role.id}`}
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </Button>
                            </Tooltip>
                            <Tooltip content="Delete role">
                                <Button
                                    variant="destructive-outline"
                                    size="xs"
                                    onClick={() => handleDelete(role)}
                                    aria-label="Delete role"
                                    id={`delete-role-${role.id}`}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </Tooltip>
                        </div>
                    );
                },
            },
        ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    // ─── Loading ───
    if (loading) {
        return (
            <div className="space-y-section animate-fadeIn">
                <PageBreadcrumbs
                    items={[
                        { label: 'Dashboard', href: tenantHref('/dashboard') },
                        { label: 'Admin', href: tenantHref('/admin') },
                        { label: 'Custom Roles' },
                    ]}
                    className="mb-1"
                />
                <Heading level={2} className="flex items-center gap-tight">
                    <Shield className="w-6 h-6 text-[var(--brand-default)]" />
                    Loading Custom Roles…
                </Heading>
                <Card className="space-y-default">
                    <div className="h-4 bg-bg-elevated/60 rounded w-1/3 animate-pulse" />
                    <div className="h-4 bg-bg-elevated/60 rounded w-2/3 animate-pulse" />
                    <div className="h-4 bg-bg-elevated/60 rounded w-1/2 animate-pulse" />
                </Card>
            </div>
        );
    }

    return (
        <ListPageShell>
            <ListPageShell.Header>
                <div className="flex items-center justify-between flex-wrap gap-default">
                    <div>
                        <Heading level={1} className="flex items-center gap-tight">
                            <Shield className="w-6 h-6 text-[var(--brand-default)]" />
                            Custom Roles
                        </Heading>
                        <p className="text-sm text-content-muted mt-1">
                            {roles.length} custom role{roles.length !== 1 ? 's' : ''} defined.
                            Members assigned a custom role use its permissions instead of the built-in role defaults.
                        </p>
                    </div>
                    {!showCreate && !editingId && (
                        <Button
                            variant="primary"
                            onClick={() => setShowCreate(true)}
                            id="create-role-btn"
                        >
                            + Role
                        </Button>
                    )}
                </div>
            </ListPageShell.Header>

            <ListPageShell.Filters className="space-y-default">
                {/* Messages */}
                {error && (
                    <InlineNotice
                        variant="error"
                        id="roles-error"
                        onDismiss={() => setError(null)}
                    >
                        {error}
                    </InlineNotice>
                )}
                {success && (
                    <InlineNotice
                        variant="success"
                        id="roles-success"
                        onDismiss={() => setSuccess(null)}
                    >
                        {success}
                    </InlineNotice>
                )}

                {/* Create Form */}
                {showCreate && (
                    <div className={cn(cardVariants(), 'border border-[var(--brand-default)]/30')} id="create-role-form">
                        <Heading level={3} className="mb-4">Create Custom Role</Heading>
                        <RoleForm
                            onSubmit={handleCreate}
                            onCancel={() => setShowCreate(false)}
                            submitting={submitting}
                            submitLabel="Create Role"
                        />
                    </div>
                )}

                {/* Edit Form (Epic 48 migration — moved from inline-row expansion to
                    above-table panel; matches the create-form pattern) */}
                {editingRole && (
                    <div className={cn(cardVariants(), 'border border-[var(--brand-default)]/30')} id="edit-role-form">
                        <Heading level={3} className="mb-4">
                            Edit: {editingRole.name}
                        </Heading>
                        <RoleForm
                            initial={editingRole}
                            onSubmit={(data) => handleUpdate(editingRole.id, data)}
                            onCancel={() => setEditingId(null)}
                            submitting={submitting}
                            submitLabel="Save Changes"
                        />
                    </div>
                )}
            </ListPageShell.Filters>

            <ListPageShell.Body>
                {/* R13-PR5 — outer `cardVariants` wrapper dropped so
                    the DataTable's own bordered card is the only one
                    (matches Controls list visually). The wrapper div
                    stays so the `roles-table-card` id is preserved
                    for the E2E + analytics selectors that depend on
                    it. */}
                <div id="roles-table-card">
                    <DataTable
                        fillBody
                        data={visibleRoles}
                        columns={roleColumns}
                        getRowId={(r) => r.id}
                        batchActions={[roleBulkAction]}
                        emptyState='No custom roles defined yet. Click "Create Custom Role" to get started.'
                        resourceName={(p) => (p ? 'custom roles' : 'custom role')}
                        data-testid="roles-table"
                    />
                </div>
            </ListPageShell.Body>
            {roleDeleteDialog}
        </ListPageShell>
    );
}
