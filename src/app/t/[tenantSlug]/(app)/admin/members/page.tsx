'use client';
/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Members & Roles admin — Epic 48 DataTable migration.
 *
 * Two stacked DataTables (members + pending invites) replacing
 * the previous hand-rolled `<table className="data-table">`
 * markup. Same data, same handlers, same stable IDs — the only
 * thing that changes is the rendering layer.
 *
 * The page stays in the ListPageShell-coverage exemption list
 * for the same reason `admin/api-keys/page.tsx` is exempt:
 * multi-table layout (members + invites stacked) doesn't fit
 * the viewport-clamp pattern that ListPageShell exists for.
 */

import { formatDate } from '@/lib/format-date';
import { useTranslations } from 'next-intl';
import { Card, cardVariants } from '@/components/ui/card';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import {
    Users, UserPlus, ChevronDown, Shield, XCircle,
    MoreVertical, UserMinus, Mail, Monitor, Award,
    Trash2, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, statusBadgeVariants } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonButton } from '@/components/ui/skeleton';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Tooltip } from '@/components/ui/tooltip';
import { DataTable, createColumns, useBulkDelete } from '@/components/ui/table';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { InlineNotice } from '@/components/ui/inline-notice';
import { cn } from '@/lib/cn';
import { Heading } from '@/components/ui/typography';
import { PageBreadcrumbs } from '@/components/layout/PageBreadcrumbs';

// ─── Types ───

interface CustomRoleOption {
    id: string;
    name: string;
    baseRole: string;
}

interface Member {
    id: string;
    userId: string;
    role: string;
    customRoleId: string | null;
    customRole: { id: string; name: string } | null;
    status: string;
    invitedAt: string | null;
    deactivatedAt: string | null;
    createdAt: string;
    user: {
        id: string;
        name: string | null;
        email: string;
        image: string | null;
        createdAt: string;
    };
    invitedBy: { id: string; name: string | null } | null;
    /** Epic C.3 — count of live (non-revoked, non-expired) sessions. */
    activeSessionCount?: number;
    /** БАБХ farm-record — plant-protection certificates. */
    applicatorCertNo?: string | null;
    agronomistCertNo?: string | null;
    agronomistName?: string | null;
}

interface MemberSession {
    sessionId: string;
    userId: string;
    tenantId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    expiresAt: string;
    lastActiveAt: string;
}

interface Invite {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    createdAt: string;
    invitedBy: { id: string; name: string | null } | null;
}

const ROLES = ['ADMIN', 'EDITOR', 'AUDITOR', 'READER'] as const;
const ROLE_VARIANT: Record<string, 'error' | 'info' | 'warning' | 'neutral'> = {
    ADMIN: 'error',
    EDITOR: 'info',
    AUDITOR: 'warning',
    READER: 'neutral',
};
const ROLE_CB_OPTIONS: ComboboxOption[] = ROLES.map(r => ({ value: r, label: r }));
const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
    ACTIVE: 'success',
    INVITED: 'warning',
    DEACTIVATED: 'error',
    REMOVED: 'neutral',
};

export default function MembersAdminPage() {
    const t = useTranslations('admin.members');
    const apiUrl = useTenantApiUrl();
    const tenantHref = useTenantHref();

    // ─── State ───
    const [members, setMembers] = useState<Member[]>([]);
    const [invites, setInvites] = useState<Invite[]>([]);
    const [loading, setLoading] = useState(true);
    // R14-PR7 — standalone search input retired. Member lists are
    // typically <50; users can scroll or navigate to a specific
    // member via the global command palette (⌘K).
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Invite form
    const [showInvite, setShowInvite] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<string>('READER');
    const [inviting, setInviting] = useState(false);

    // Role change
    const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
    const [pendingRole, setPendingRole] = useState<string>('');
    const [pendingCustomRoleId, setPendingCustomRoleId] = useState<string | null>(null);
    const [changingRole, setChangingRole] = useState(false);

    // Custom roles
    const [customRoles, setCustomRoles] = useState<CustomRoleOption[]>([]);

    // Action menu
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);

    // Epic C.3 — sessions modal
    const [sessionsModalUser, setSessionsModalUser] = useState<Member | null>(null);
    const [memberSessions, setMemberSessions] = useState<MemberSession[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

    // БАБХ farm-record — plant-protection certificates modal
    const [certsModalMember, setCertsModalMember] = useState<Member | null>(null);
    const [certApplicator, setCertApplicator] = useState('');
    const [certAgronomistName, setCertAgronomistName] = useState('');
    const [certAgronomistNo, setCertAgronomistNo] = useState('');
    const [savingCerts, setSavingCerts] = useState(false);

    // ─── Data fetching ───
    const fetchMembers = useCallback(async () => {
        try {
            const [membersRes, invitesRes, rolesRes] = await Promise.all([
                fetch(apiUrl('/admin/members')),
                fetch(apiUrl('/admin/members?view=invites')),
                fetch(apiUrl('/admin/roles')),
            ]);
            if (membersRes.ok) setMembers(await membersRes.json());
            if (invitesRes.ok) setInvites(await invitesRes.json());
            if (rolesRes.ok) {
                const allRoles = await rolesRes.json();
                setCustomRoles(allRoles.filter((r: CustomRoleOption & { isActive: boolean }) => r.isActive));
            }
        } catch {
            setError(t('loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [apiUrl, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchMembers(); }, [fetchMembers]);

    // Bulk-revoke for the pending-invitations table — selection action-row.
    const { batchAction: inviteBulkAction, dialog: inviteRevokeDialog } =
        useBulkDelete<Invite>({
            entitySingular: t('invitationSingular'),
            entityPlural: t('invitationPlural'),
            verb: 'Revoke',
            onDelete: async (inviteIds) => {
                const res = await fetch(apiUrl('/admin/invites/bulk/delete'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inviteIds }),
                });
                if (!res.ok) throw new Error(t('revokeInvitesFailed'));
                await fetchMembers();
            },
        });

    // Bulk "Remove" (→ REMOVED) — selection action-row. Hard removal; the
    // usecase skips your own membership and protects the last active
    // OWNER/ADMIN. Deactivate is the sibling batch action (defined inline on
    // the DataTable below) so the action-row offers BOTH choices.
    const { batchAction: removeBulkAction, dialog: removeBulkDialog } =
        useBulkDelete<Member>({
            entitySingular: t('memberSingular'),
            entityPlural: t('memberPlural'),
            verb: 'Remove',
            onDelete: async (membershipIds) => {
                const res = await fetch(apiUrl('/admin/members/bulk/remove'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ membershipIds }),
                });
                if (!res.ok) throw new Error(t('removeMembersFailed'));
                setSuccess(t('membersRemoved', { count: membershipIds.length }));
                await fetchMembers();
            },
        });

    // ─── Handlers (unchanged from pre-migration) ───
    async function handleInvite() {
        if (!inviteEmail.trim()) return;
        setError(null);
        setSuccess(null);
        setInviting(true);

        try {
            const res = await fetch(apiUrl('/admin/members'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role: inviteRole }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: t('inviteFailed') }));
                setError(err.error || err.message || t('inviteFailed'));
                return;
            }

            const data = await res.json();
            // The route always creates an invite and reports whether the email
            // actually went out (emailSent). When it didn't — e.g. SMTP isn't
            // configured — be honest and surface the acceptance link so the
            // admin can share it manually instead of a false "emailed" toast.
            setSuccess(
                data.emailSent
                    ? t('inviteEmailed', { email: inviteEmail })
                    : t('inviteCreatedNoEmail', { email: inviteEmail, link: `${window.location.origin}${data.url ?? ''}` }),
            );
            setInviteEmail('');
            setInviteRole('READER');
            setShowInvite(false);
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setInviting(false);
        }
    }

    async function handleRoleChange(membershipId: string) {
        setError(null);
        setSuccess(null);
        setChangingRole(true);

        try {
            const member = members.find(m => m.id === membershipId);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payload: Record<string, any> = {};
            if (pendingRole && pendingRole !== member?.role) {
                payload.role = pendingRole;
            }
            if (pendingCustomRoleId !== (member?.customRoleId ?? null)) {
                payload.customRoleId = pendingCustomRoleId;
            }

            if (Object.keys(payload).length === 0) {
                setEditingRoleId(null);
                return;
            }

            const res = await fetch(apiUrl(`/admin/members/${membershipId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: t('roleChangeFailed') }));
                setError(err.error || err.message || t('roleChangeFailed'));
                return;
            }

            setSuccess(t('roleUpdated'));
            setEditingRoleId(null);
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setChangingRole(false);
        }
    }

    async function handleDeactivate(membershipId: string, email: string) {
        if (!confirm(t('confirmDeactivate', { email }))) return;
        setError(null);
        setSuccess(null);
        setOpenMenuId(null);

        try {
            const res = await fetch(apiUrl(`/admin/members/${membershipId}/deactivate`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: t('deactivationFailed') }));
                setError(err.error || err.message || t('deactivationFailed'));
                return;
            }

            setSuccess(t('memberDeactivated', { email }));
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    // Bulk "Deactivate" — the reversible sibling of bulk Remove. A plain
    // BatchAction (not useBulkDelete, whose canonical danger verbs exclude
    // "Deactivate"); a lightweight confirm matches the per-row deactivate.
    async function handleBulkDeactivate(membershipIds: string[]) {
        if (membershipIds.length === 0) return;
        if (!confirm(t('confirmBulkDeactivate', { count: membershipIds.length }))) return;
        setError(null);
        setSuccess(null);
        try {
            const res = await fetch(apiUrl('/admin/members/bulk/delete'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ membershipIds }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: t('deactivationFailed') }));
                setError(err.error || err.message || t('deactivationFailed'));
                return;
            }
            const data = await res.json().catch(() => ({ deactivated: membershipIds.length }));
            setSuccess(t('membersDeactivated', { count: data.deactivated ?? membershipIds.length }));
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    // Reactivate a deactivated member (constructive — no confirm needed).
    async function handleReactivate(membershipId: string, email: string) {
        setError(null);
        setSuccess(null);
        setOpenMenuId(null);
        try {
            const res = await fetch(apiUrl(`/admin/members/${membershipId}/reactivate`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: t('reactivateFailed') }));
                setError(err.error || err.message || t('reactivateFailed'));
                return;
            }
            setSuccess(t('memberReactivated', { email }));
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    // Fully remove a member (→ REMOVED) — leaves the members list.
    async function handleRemove(membershipId: string, email: string) {
        if (!confirm(t('confirmRemove', { email }))) return;
        setError(null);
        setSuccess(null);
        setOpenMenuId(null);
        try {
            const res = await fetch(apiUrl(`/admin/members/${membershipId}`), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: t('removeFailed') }));
                setError(err.error || err.message || t('removeFailed'));
                return;
            }
            setSuccess(t('memberRemoved', { email }));
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    const openSessionsModal = useCallback(async (member: Member) => {
        setSessionsModalUser(member);
        setSessionsLoading(true);
        setMemberSessions([]);
        try {
            const res = await fetch(
                apiUrl(`/admin/sessions?userId=${encodeURIComponent(member.userId)}`),
            );
            if (res.ok) {
                const data = await res.json() as { sessions: MemberSession[] };
                setMemberSessions(data.sessions);
            } else {
                setError(t('loadSessionsFailed'));
            }
        } catch {
            setError('Failed to load sessions');
        } finally {
            setSessionsLoading(false);
        }
    }, [apiUrl]);

    const closeSessionsModal = useCallback(() => {
        setSessionsModalUser(null);
        setMemberSessions([]);
    }, []);

    // ── БАБХ farm-record — certificates modal ──
    const openCertsModal = useCallback((member: Member) => {
        setCertsModalMember(member);
        setCertApplicator(member.applicatorCertNo ?? '');
        setCertAgronomistName(member.agronomistName ?? '');
        setCertAgronomistNo(member.agronomistCertNo ?? '');
    }, []);

    const closeCertsModal = useCallback(() => {
        setCertsModalMember(null);
    }, []);

    const handleSaveCerts = useCallback(async () => {
        if (!certsModalMember) return;
        setSavingCerts(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await fetch(
                apiUrl(`/admin/members/${certsModalMember.id}/certificates`),
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        applicatorCertNo: certApplicator.trim() || null,
                        agronomistName: certAgronomistName.trim() || null,
                        agronomistCertNo: certAgronomistNo.trim() || null,
                    }),
                },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err?.error?.message || err?.error || t('saveCertsFailed'));
                return;
            }
            setSuccess(t('certsUpdated'));
            setCertsModalMember(null);
            await fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSavingCerts(false);
        }
    }, [apiUrl, certsModalMember, certApplicator, certAgronomistName, certAgronomistNo, fetchMembers]);

    const handleRevokeSession = useCallback(async (sessionId: string) => {
        if (!sessionsModalUser) return;
        if (!confirm(t('confirmRevokeSession'))) return;
        setRevokingSessionId(sessionId);
        try {
            const res = await fetch(apiUrl('/admin/sessions'), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, reason: `Revoked from members admin UI` }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err?.error?.message || t('revocationFailed'));
                return;
            }
            setMemberSessions((sessions) => sessions.filter((s) => s.sessionId !== sessionId));
            setSuccess(t('sessionRevoked'));
            void fetchMembers();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setRevokingSessionId(null);
        }
    }, [apiUrl, fetchMembers, sessionsModalUser]);

    // ─── Filter (R14-PR7 — search retired; full list shown) ───
    const filteredMembers = members;

    // ─── Members DataTable columns ───
    const memberColumns = useMemo(
        () => createColumns<Member>([
            {
                id: 'member',
                header: t('colMember'),
                accessorFn: (m) => m.user.name ?? m.user.email,
                cell: ({ row }) => {
                    const m = row.original;
                    return (
                        <div className="flex items-center gap-tight">
                            <InitialsAvatar
                                value={m.user.name || m.user.email}
                                size="md"
                                imageUrl={m.user.image}
                            />
                            <span className="text-sm font-medium text-content-emphasis">{m.user.name || '—'}</span>
                        </div>
                    );
                },
            },
            {
                id: 'email',
                header: t('colEmail'),
                accessorFn: (m) => m.user.email,
                cell: ({ row }) => (
                    <span className="text-content-muted">{row.original.user.email}</span>
                ),
            },
            {
                id: 'role',
                header: t('colRole'),
                accessorKey: 'role',
                cell: ({ row }) => {
                    const m = row.original;
                    if (editingRoleId === m.id) {
                        return (
                            <div className="space-y-1">
                                <div className="flex items-center gap-1">
                                    <Combobox
                                        hideSearch
                                        id={`role-select-${m.id}`}
                                        selected={ROLE_CB_OPTIONS.find(o => o.value === pendingRole) ?? null}
                                        setSelected={(opt) => setPendingRole(opt?.value ?? pendingRole)}
                                        options={ROLE_CB_OPTIONS}
                                        matchTriggerWidth
                                        buttonProps={{ className: 'text-xs py-1 px-2 w-full sm:w-28' }}
                                    />
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        onClick={() => handleRoleChange(m.id)}
                                        disabled={changingRole}
                                        loading={changingRole}
                                        id={`role-save-${m.id}`}
                                    >
                                        {t('save')}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        onClick={() => setEditingRoleId(null)}
                                        icon={<XCircle className="w-3.5 h-3.5" />}
                                    />
                                </div>
                                {customRoles.length > 0 && (
                                    <Combobox
                                        hideSearch
                                        id={`custom-role-select-${m.id}`}
                                        selected={customRoles.map(cr => ({ value: cr.id, label: cr.name })).find(o => o.value === (pendingCustomRoleId ?? '')) ?? null}
                                        setSelected={(opt) => setPendingCustomRoleId(opt?.value || null)}
                                        options={customRoles.map(cr => ({ value: cr.id, label: cr.name }))}
                                        placeholder={t('noCustomRole')}
                                        matchTriggerWidth
                                        buttonProps={{ className: 'text-xs py-1 px-2 w-full sm:w-48' }}
                                    />
                                )}
                            </div>
                        );
                    }
                    return (
                        <div className="flex items-center gap-1 flex-wrap">
                            <Tooltip
                                content={t('clickToChangeRole')}
                                disabled={m.status !== 'ACTIVE'}
                            >
                                <button
                                    type="button"
                                    className={cn(
                                        statusBadgeVariants({ variant: ROLE_VARIANT[m.role] || 'neutral' }),
                                        'cursor-pointer hover:opacity-80 transition',
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (m.status === 'ACTIVE') {
                                            setEditingRoleId(m.id);
                                            setPendingRole(m.role);
                                            setPendingCustomRoleId(m.customRoleId);
                                        }
                                    }}
                                    id={`role-badge-${m.id}`}
                                >
                                    {m.role}
                                    {m.status === 'ACTIVE' && <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
                                </button>
                            </Tooltip>
                            {m.customRole && (
                                <Tooltip
                                    title={t('customRole')}
                                    content={m.customRole.name}
                                >
                                    <span className="inline-flex items-center rounded-md px-2 py-1 text-[10px] font-medium bg-info text-content-info border border-border-info cursor-help">
                                        {m.customRole.name}
                                    </span>
                                </Tooltip>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'status',
                header: t('colStatus'),
                accessorKey: 'status',
                cell: ({ row }) => (
                    <StatusBadge variant={STATUS_VARIANT[row.original.status] || 'neutral'} icon={null} size="sm">
                        {row.original.status}
                    </StatusBadge>
                ),
            },
            {
                id: 'sessions',
                header: t('colSessions'),
                accessorFn: (m) => m.activeSessionCount ?? 0,
                cell: ({ row }) => {
                    const m = row.original;
                    const count = m.activeSessionCount ?? 0;
                    return (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                void openSessionsModal(m);
                            }}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border transition-colors',
                                count > 0
                                    ? 'bg-bg-success text-content-success border-border-success hover:bg-bg-success'
                                    : 'bg-bg-muted text-content-subtle border-border-subtle hover:bg-bg-muted',
                            )}
                            id={`sessions-count-${m.id}`}
                            aria-label={t('viewSessionsAria', { count, email: m.user.email })}
                        >
                            <Monitor className="w-3.5 h-3.5" />
                            {count}
                        </button>
                    );
                },
            },
            {
                id: 'joined',
                header: t('colJoined'),
                accessorKey: 'createdAt',
                cell: ({ row }) => (
                    <span className="text-content-subtle">{formatDate(row.original.createdAt)}</span>
                ),
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => {
                    const m = row.original;
                    const isActive = m.status === 'ACTIVE';
                    return (
                        <div className="relative inline-block text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                                variant="secondary"
                                size="xs"
                                onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                                icon={<MoreVertical className="w-3.5 h-3.5" />}
                                id={`member-menu-${m.id}`}
                            />
                            {openMenuId === m.id && (
                                <div className="absolute right-0 top-full mt-1 bg-bg-default border border-border-default rounded-lg shadow-lg z-20 min-w-[160px]">
                                    {isActive && (
                                        <>
                                            <button
                                                onClick={() => {
                                                    setEditingRoleId(m.id);
                                                    setPendingRole(m.role);
                                                    setOpenMenuId(null);
                                                }}
                                                className="w-full text-left px-3 py-2 text-xs text-content-emphasis hover:bg-bg-muted flex items-center gap-tight"
                                                id={`action-change-role-${m.id}`}
                                            >
                                                <Shield className="w-3.5 h-3.5" />
                                                {t('changeRole')}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setOpenMenuId(null);
                                                    void openSessionsModal(m);
                                                }}
                                                className="w-full text-left px-3 py-2 text-xs text-content-emphasis hover:bg-bg-muted flex items-center gap-tight"
                                                id={`action-view-sessions-${m.id}`}
                                            >
                                                <Monitor className="w-3.5 h-3.5" />
                                                {t('viewSessions')}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setOpenMenuId(null);
                                                    openCertsModal(m);
                                                }}
                                                className="w-full text-left px-3 py-2 text-xs text-content-emphasis hover:bg-bg-muted flex items-center gap-tight"
                                                id={`action-certificates-${m.id}`}
                                            >
                                                <Award className="w-3.5 h-3.5" />
                                                {t('certificates')}
                                            </button>
                                            <button
                                                onClick={() => handleDeactivate(m.id, m.user.email)}
                                                className="w-full text-left px-3 py-2 text-xs text-content-emphasis hover:bg-bg-muted flex items-center gap-tight"
                                                id={`action-deactivate-${m.id}`}
                                            >
                                                <UserMinus className="w-3.5 h-3.5" />
                                                {t('deactivate')}
                                            </button>
                                        </>
                                    )}
                                    {m.status === 'DEACTIVATED' && (
                                        <button
                                            onClick={() => handleReactivate(m.id, m.user.email)}
                                            className="w-full text-left px-3 py-2 text-xs text-content-emphasis hover:bg-bg-muted flex items-center gap-tight"
                                            id={`action-reactivate-${m.id}`}
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            {t('reactivate')}
                                        </button>
                                    )}
                                    {/* Remove (→ REMOVED) — available for every member row. */}
                                    <button
                                        onClick={() => handleRemove(m.id, m.user.email)}
                                        className="w-full text-left px-3 py-2 text-xs text-content-error hover:bg-bg-error flex items-center gap-tight"
                                        id={`action-remove-${m.id}`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        {t('removeVerb')}
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                },
            },
        ]),
        // Re-derive columns when any state used inline by the cells
        // changes — otherwise the inline edit row's combobox would
        // render with a stale selection.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [editingRoleId, pendingRole, pendingCustomRoleId, changingRole, customRoles, openMenuId],
    );

    // ─── Invites DataTable columns ───
    const inviteColumns = useMemo(
        () => createColumns<Invite>([
            {
                id: 'email',
                header: t('colEmail'),
                accessorKey: 'email',
                cell: ({ row }) => (
                    <span className="text-sm text-content-emphasis">{row.original.email}</span>
                ),
            },
            {
                id: 'role',
                header: t('colRole'),
                accessorKey: 'role',
                cell: ({ row }) => (
                    <StatusBadge variant={ROLE_VARIANT[row.original.role] || 'neutral'} icon={null}>
                        {row.original.role}
                    </StatusBadge>
                ),
            },
            {
                id: 'invitedBy',
                header: t('colInvitedBy'),
                accessorFn: (i) => i.invitedBy?.name ?? '—',
                cell: ({ row }) => (
                    <span className="text-content-muted">{row.original.invitedBy?.name || '—'}</span>
                ),
            },
            {
                id: 'expires',
                header: t('colExpires'),
                accessorKey: 'expiresAt',
                cell: ({ row }) => (
                    <span className="text-content-subtle">{formatDate(row.original.expiresAt)}</span>
                ),
            },
        ]),
        [],
    );

    // ─── Loading state ───
    if (loading) {
        return (
            <div className="space-y-section animate-fadeIn">
                <PageBreadcrumbs
                    items={[
                        { label: t('breadcrumbDashboard'), href: tenantHref('/dashboard') },
                        { label: t('breadcrumbAdmin'), href: tenantHref('/admin') },
                        { label: t('breadcrumbMembers') },
                    ]}
                    className="mb-1"
                />
                <Heading level={2} className="flex items-center gap-tight">
                    <Users className="w-6 h-6 text-[var(--brand-default)]" />
                    {t('loading')}
                </Heading>
                <Card className="space-y-default">
                    <div className="h-4 bg-bg-subtle rounded w-1/3 animate-pulse" />
                    <div className="h-4 bg-bg-subtle rounded w-2/3 animate-pulse" />
                    <div className="h-4 bg-bg-subtle rounded w-1/2 animate-pulse" />
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-section animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-default">
                <div>
                    <Heading level={1} className="flex items-center gap-tight">
                        <Users className="w-6 h-6 text-[var(--brand-default)]" />
                        {t('heading')}
                    </Heading>
                    <p className="text-sm text-content-muted mt-1">
                        {t('activeMembers', { count: members.filter(m => m.status === 'ACTIVE').length })}
                        {invites.length > 0 && t('pendingInvitesSuffix', { count: invites.length })}
                    </p>
                </div>
                <Button
                    variant="primary"
                    onClick={() => setShowInvite(true)}
                    icon={<UserPlus className="w-3.5 h-3.5" />}
                    id="invite-member-btn"
                >
                    {t('inviteMember')}
                </Button>
            </div>

            {/* Messages */}
            {error && (
                <InlineNotice
                    variant="error"
                    id="members-error"
                    onDismiss={() => setError(null)}
                >
                    {error}
                </InlineNotice>
            )}
            {success && (
                <InlineNotice
                    variant="success"
                    id="members-success"
                    onDismiss={() => setSuccess(null)}
                >
                    {success}
                </InlineNotice>
            )}

            {/* Invite Form */}
            {showInvite && (
                <div className={cn(cardVariants(), 'border border-[var(--brand-default)]/30')} id="invite-form">
                    <Heading level={3} className="mb-4">{t('inviteNewMember')}</Heading>
                    <div className="flex gap-compact items-end flex-wrap">
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                                {t('emailAddress')}
                            </label>
                            <input
                                id="invite-email-input"
                                type="email"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                placeholder={t('emailPlaceholder')}
                                className="input w-full"
                                autoFocus
                            />
                        </div>
                        <div className="w-full sm:w-40">
                            <label className="text-xs text-content-muted uppercase tracking-wider mb-1 block">
                                {t('roleLabel')}
                            </label>
                            <Combobox
                                hideSearch
                                id="invite-role-select"
                                selected={ROLE_CB_OPTIONS.find(o => o.value === inviteRole) ?? null}
                                setSelected={(opt) => setInviteRole(opt?.value ?? 'READER')}
                                options={ROLE_CB_OPTIONS}
                                matchTriggerWidth
                            />
                        </div>
                        <Button
                            variant="primary"
                            onClick={handleInvite}
                            disabled={inviting || !inviteEmail.trim()}
                            loading={inviting}
                            icon={<Mail className="w-3.5 h-3.5" />}
                            id="send-invite-btn"
                        >
                            {t('sendInvite')}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => { setShowInvite(false); setInviteEmail(''); }}
                        >
                            {t('cancel')}
                        </Button>
                    </div>
                </div>
            )}

            {/* R14-PR7 — standalone "Search members" input retired.
                Find a specific member via the global command palette
                (⌘K) or scroll the list. If granular filtering becomes
                load-bearing here, adopt FilterToolbar — never
                reintroduce a hand-rolled `<input>` per CLAUDE.md
                filter strategy. */}

            {/* Members DataTable (Epic 48 migration).
                R13-PR5 — the outer `cardVariants({ density: 'none' })`
                wrapper was dropped so the DataTable primitive's own
                `bg-bg-default rounded-lg border-border-subtle` card
                is the only one (matches Controls list visually). */}
            <div id="members-table-card">
                {filteredMembers.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={t('noMembersYet')}
                    />
                ) : (
                    <DataTable
                        data={filteredMembers}
                        columns={memberColumns}
                        getRowId={(m) => m.id}
                        batchActions={[
                            {
                                label: t('deactivate'),
                                icon: <UserMinus className="w-3.5 h-3.5" />,
                                onClick: (rows) =>
                                    void handleBulkDeactivate(rows.map((r) => r.original.id)),
                            },
                            removeBulkAction,
                        ]}
                        emptyState={t('noMembers')}
                        resourceName={(p) => (p ? t('memberPlural') : t('memberSingular'))}
                        data-testid="members-table"
                    />
                )}
                {removeBulkDialog}
            </div>

            {/* Pending Invites DataTable */}
            {invites.length > 0 && (
                <div>
                    <Heading level={2} className="mb-3">{t('pendingInvitations')}</Heading>
                    <div id="invites-table-card">
                        <DataTable
                            data={invites}
                            columns={inviteColumns}
                            getRowId={(i) => i.id}
                            batchActions={[inviteBulkAction]}
                            emptyState={t('noPendingInvites')}
                            resourceName={(p) => (p ? t('invitePlural') : t('inviteSingular'))}
                            data-testid="invites-table"
                        />
                    </div>
                    {inviteRevokeDialog}
                </div>
            )}

            {/* Click-away handler for action menu */}
            {openMenuId && (
                <div
                    className="fixed inset-0 z-10"
                    onClick={() => setOpenMenuId(null)}
                />
            )}

            {/* Epic C.3 — sessions modal (Epic 54 Modal primitive) */}
            <Modal
                showModal={sessionsModalUser !== null}
                setShowModal={(open) => {
                    if (!open) closeSessionsModal();
                }}
                size="lg"
                title={sessionsModalUser
                    ? t('sessionsFor', { name: sessionsModalUser.user.name || sessionsModalUser.user.email })
                    : t('sessions')}
                description={t('sessionsModalDesc')}
            >
                <Modal.Header
                    title={sessionsModalUser
                        ? t('sessionsFor', { name: sessionsModalUser.user.name || sessionsModalUser.user.email })
                        : t('sessions')}
                    description={memberSessions.length === 0 && !sessionsLoading
                        ? t('noActiveSessionsShort')
                        : t('activeSessionsCount', { count: memberSessions.length })}
                />
                <Modal.Body>
                    {sessionsLoading ? (
                        <ul className="space-y-tight" aria-busy="true" aria-label={t('loadingSessions')}>
                            {Array.from({ length: 3 }).map((_, i) => (
                                <li
                                    key={i}
                                    className="border border-border-subtle rounded-md p-3 flex items-start justify-between gap-compact"
                                >
                                    <div className="min-w-0 flex-1 space-y-tight">
                                        <Skeleton className="h-4 w-2/3" />
                                        <Skeleton className="h-3 w-1/2" />
                                    </div>
                                    <SkeletonButton className="h-6 w-16" />
                                </li>
                            ))}
                        </ul>
                    ) : memberSessions.length === 0 ? (
                        <EmptyState
                            icon={Monitor}
                            title={t('noActiveSessions')}
                            description={t('noActiveSessionsDesc')}
                        />
                    ) : (
                        <ul className="space-y-tight" id="sessions-list">
                            {memberSessions.map((s) => (
                                <li
                                    key={s.sessionId}
                                    className="border border-border-subtle rounded-md p-3 flex items-start justify-between gap-compact"
                                    data-session-id={s.sessionId}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-content-emphasis truncate">
                                            {s.userAgent || t('unknownDevice')}
                                        </p>
                                        <p className="text-xs text-content-muted mt-0.5">
                                            {t('ipLastActive', { ip: s.ipAddress || '—', date: formatDate(s.lastActiveAt) })}
                                        </p>
                                        <p className="text-[10px] text-content-subtle mt-0.5 font-mono break-all">
                                            {s.sessionId}
                                        </p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        onClick={() => handleRevokeSession(s.sessionId)}
                                        disabled={revokingSessionId === s.sessionId}
                                        id={`revoke-session-${s.sessionId}`}
                                    >
                                        {revokingSessionId === s.sessionId ? t('revoking') : t('revoke')}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Modal.Body>
            </Modal>

            {/* БАБХ farm-record — plant-protection certificates modal */}
            <Modal
                showModal={certsModalMember !== null}
                setShowModal={(open) => { if (!open) closeCertsModal(); }}
                size="md"
                title={t('certificatesTitle')}
                description={t('certificatesDesc')}
            >
                <Modal.Header
                    title={certsModalMember
                        ? t('certificatesForMember', { name: certsModalMember.user.name || certsModalMember.user.email })
                        : t('certificatesTitle')}
                    description={t('certificatesEditableNote')}
                />
                <Modal.Body>
                    <div className="space-y-default">
                        <FormField
                            label="Сертификат на приложителя (чл. 84 ал. 2)"
                            description="№ на сертификат на лицето, което извършва третирането (чл. 83 ЗЗР)."
                        >
                            <Input
                                value={certApplicator}
                                onChange={(e) => setCertApplicator(e.target.value)}
                                id="cert-applicator-input"
                            />
                        </FormField>
                        <FormField label="Агроном — име (чл. 84 ал. 1)">
                            <Input
                                value={certAgronomistName}
                                onChange={(e) => setCertAgronomistName(e.target.value)}
                                id="cert-agronomist-name-input"
                            />
                        </FormField>
                        <FormField label="Агроном — № сертификат">
                            <Input
                                value={certAgronomistNo}
                                onChange={(e) => setCertAgronomistNo(e.target.value)}
                                id="cert-agronomist-no-input"
                            />
                        </FormField>
                        <div className="flex justify-end gap-tight">
                            <Button
                                variant="secondary"
                                onClick={closeCertsModal}
                                disabled={savingCerts}
                                id="cert-cancel-btn"
                            >
                                {t('cancel')}
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleSaveCerts}
                                disabled={savingCerts}
                                loading={savingCerts}
                                id="cert-save-btn"
                            >
                                {t('saveCertificates')}
                            </Button>
                        </div>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
}
