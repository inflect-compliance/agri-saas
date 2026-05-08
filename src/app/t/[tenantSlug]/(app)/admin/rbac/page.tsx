import { formatDate } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { resolveTenantContext } from '@/lib/tenant-context';
import { getPermissionsForRole, type PermissionSet } from '@/lib/permissions';
import prisma from '@/lib/prisma';
import type { Role } from '@prisma/client';
import { Check } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Admin-only RBAC overview page.
 * Authorization: handled by centralized admin layout guard.
 * Shows: permission matrix by role, current tenant members + roles.
 */
export default async function RbacPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;

    // ─── Server-side guard ───
    const session = await auth();
    if (!session?.user?.id) redirect('/login');

    let tenantCtx;
    try {
        tenantCtx = await resolveTenantContext({ tenantSlug }, session.user.id);
    } catch {
        redirect(`/t/${tenantSlug}/dashboard`);
    }



    // ─── Data fetching ───
    const members = await prisma.tenantMembership.findMany({
        where: { tenantId: tenantCtx.tenant.id },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
    });

    const roles: Role[] = ['OWNER', 'ADMIN', 'EDITOR', 'AUDITOR', 'READER'];
    const permissionMatrix: Record<Role, PermissionSet> = {
        OWNER: getPermissionsForRole('OWNER'),
        ADMIN: getPermissionsForRole('ADMIN'),
        EDITOR: getPermissionsForRole('EDITOR'),
        AUDITOR: getPermissionsForRole('AUDITOR'),
        READER: getPermissionsForRole('READER'),
    };

    // Flatten permission keys for the matrix table
    const permissionRows: { resource: string; action: string }[] = [];
    const sampleSet = permissionMatrix.ADMIN;
    for (const [resource, actions] of Object.entries(sampleSet)) {
        for (const action of Object.keys(actions as Record<string, boolean>)) {
            permissionRows.push({ resource, action });
        }
    }

    return (
        <div className="space-y-8 animate-fadeIn">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold">Roles &amp; Access</h1>
                <p className="text-sm text-content-muted mt-1">
                    Permission matrix for <span className="text-content-emphasis font-medium">{tenantCtx.tenant.name}</span>.
                    Your role: <span className="badge badge-info">{tenantCtx.role}</span>
                </p>
            </div>

            {/* Members Table */}
            <section>
                <h2 className="text-lg font-semibold mb-3">Team Members</h2>
                <div className="glass-card overflow-hidden">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Joined</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map((m) => (
                                <tr key={m.id}>
                                    <td className="text-sm font-medium text-content-emphasis">
                                        {m.user.name || '—'}
                                    </td>
                                    <td className="text-xs text-content-muted">{m.user.email}</td>
                                    <td>
                                        <span className={`badge ${
                                            m.role === 'ADMIN' ? 'badge-danger' :
                                            m.role === 'EDITOR' ? 'badge-info' :
                                            m.role === 'AUDITOR' ? 'badge-warning' :
                                            'badge-neutral'
                                        }`}>{m.role}</span>
                                    </td>
                                    <td className="text-xs text-content-subtle">{formatDate(m.createdAt)}</td>
                                </tr>
                            ))}
                            {members.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="text-center text-content-subtle py-8">No members found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Permission Matrix */}
            <section>
                <h2 className="text-lg font-semibold mb-3">Permission Matrix</h2>
                <div className="glass-card overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th className="sticky left-0 bg-bg-default/90 z-10">Resource</th>
                                <th className="sticky left-[120px] bg-bg-default/90 z-10">Action</th>
                                {roles.map((r) => (
                                    <th key={r} className="text-center">{r}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {permissionRows.map(({ resource, action }) => (
                                <tr key={`${resource}.${action}`}>
                                    <td className="text-xs font-medium text-content-default sticky left-0 bg-bg-default/50">{resource}</td>
                                    <td className="text-xs text-content-muted sticky left-[120px] bg-bg-default/50">{action}</td>
                                    {roles.map((role) => {
                                        const resourcePerms = permissionMatrix[role][resource as keyof PermissionSet];
                                        const granted = (resourcePerms as Record<string, boolean>)[action];
                                        return (
                                            <td key={role} className="text-center">
                                                {granted ? (
                                                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg-success text-content-success"><Check size={10} /></span>
                                                ) : (
                                                    <span className="inline-block w-4 h-4 rounded-full bg-bg-elevated/50 text-content-subtle text-[10px] leading-4">—</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
