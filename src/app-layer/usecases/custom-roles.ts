/**
 * Custom Role CRUD Usecases
 *
 * Admin-only operations for managing tenant-defined custom roles
 * and assigning them to memberships.
 *
 * All mutations:
 *   - Require ADMIN via assertCanManageMembers
 *   - Validate permissionsJson via validatePermissionsJson
 *   - Emit audit events via logEvent
 *
 * @module usecases/custom-roles
 */
import { RequestContext } from '../types';
import { assertCanManageMembers } from '../policies/admin.policies';
import { logEvent } from '../events/audit';
import { runInTenantContext } from '@/lib/db-context';
import { notFound, badRequest } from '@/lib/errors/types';
import { validatePermissionsJson } from '@/lib/permissions';
import type { Role } from '@prisma/client';

const VALID_BASE_ROLES: Role[] = ['ADMIN', 'EDITOR', 'AUDITOR', 'READER'];

// ─── List Custom Roles ───

export async function listCustomRoles(ctx: RequestContext) {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, (db) =>
        db.tenantCustomRole.findMany({
            where: { tenantId: ctx.tenantId },
            include: {
                _count: { select: { memberships: true } },
            },
            orderBy: { createdAt: 'asc' },
        })
    );
}

// ─── Create Custom Role ───

export interface CreateCustomRoleInput {
    name: string;
    description?: string | null;
    baseRole: Role;
    permissionsJson: unknown;
}

export async function createCustomRole(ctx: RequestContext, input: CreateCustomRoleInput) {
    assertCanManageMembers(ctx);

    // Validate inputs
    const name = input.name.trim();
    if (!name || name.length > 100) {
        throw badRequest('Role name is required and must be 100 characters or fewer.');
    }

    if (!VALID_BASE_ROLES.includes(input.baseRole)) {
        throw badRequest(`Invalid base role: ${input.baseRole}`);
    }

    // Validate permissions JSON
    const errors = validatePermissionsJson(input.permissionsJson);
    if (errors.length > 0) {
        throw badRequest(`Invalid permissions: ${errors.join('; ')}`);
    }

    return runInTenantContext(ctx, async (db) => {
        // Check for duplicate name within tenant
        const existing = await db.tenantCustomRole.findFirst({
            where: { tenantId: ctx.tenantId, name },
        });
        if (existing) {
            throw badRequest(`A custom role named "${name}" already exists in this tenant.`);
        }

        const role = await db.tenantCustomRole.create({
            data: {
                tenantId: ctx.tenantId,
                name,
                description: input.description?.trim() || null,
                baseRole: input.baseRole,
                permissionsJson: input.permissionsJson as object,
                isActive: true,
            },
        });

        await logEvent(db, ctx, {
            action: 'CUSTOM_ROLE_CREATED',
            entityType: 'TenantCustomRole',
            entityId: role.id,
            details: `Created custom role: ${name} (base: ${input.baseRole})`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantCustomRole',
                operation: 'created',
                after: { name, baseRole: input.baseRole },
                summary: `Created custom role: ${name}`,
            },
        });

        return role;
    });
}

// ─── Update Custom Role ───

export interface UpdateCustomRoleInput {
    name?: string;
    description?: string | null;
    baseRole?: Role;
    permissionsJson?: unknown;
}

export async function updateCustomRole(
    ctx: RequestContext,
    roleId: string,
    input: UpdateCustomRoleInput,
) {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, async (db) => {
        const existing = await db.tenantCustomRole.findFirst({
            where: { id: roleId, tenantId: ctx.tenantId },
        });
        if (!existing) {
            throw notFound('Custom role not found.');
        }

        // Build update data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: Record<string, any> = {};

        if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name || name.length > 100) {
                throw badRequest('Role name is required and must be 100 characters or fewer.');
            }
            // Check for duplicate name
            if (name !== existing.name) {
                const dup = await db.tenantCustomRole.findFirst({
                    where: { tenantId: ctx.tenantId, name, id: { not: roleId } },
                });
                if (dup) {
                    throw badRequest(`A custom role named "${name}" already exists.`);
                }
            }
            data.name = name;
        }

        if (input.description !== undefined) {
            data.description = input.description?.trim() || null;
        }

        if (input.baseRole !== undefined) {
            if (!VALID_BASE_ROLES.includes(input.baseRole)) {
                throw badRequest(`Invalid base role: ${input.baseRole}`);
            }
            data.baseRole = input.baseRole;
        }

        if (input.permissionsJson !== undefined) {
            const errors = validatePermissionsJson(input.permissionsJson);
            if (errors.length > 0) {
                throw badRequest(`Invalid permissions: ${errors.join('; ')}`);
            }
            data.permissionsJson = input.permissionsJson as object;
        }

        if (Object.keys(data).length === 0) {
            throw badRequest('No fields to update.');
        }

        const updated = await db.tenantCustomRole.update({
            where: { id: roleId },
            data,
        });

        await logEvent(db, ctx, {
            action: 'CUSTOM_ROLE_UPDATED',
            entityType: 'TenantCustomRole',
            entityId: updated.id,
            details: `Updated custom role: ${updated.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantCustomRole',
                operation: 'updated',
                changedFields: Object.keys(data),
                summary: `Updated custom role: ${updated.name}`,
            },
        });

        return updated;
    });
}

// ─── Delete (Soft-Delete) Custom Role ───

export async function deleteCustomRole(ctx: RequestContext, roleId: string) {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, async (db) => {
        const existing = await db.tenantCustomRole.findFirst({
            where: { id: roleId, tenantId: ctx.tenantId },
        });
        if (!existing) {
            throw notFound('Custom role not found.');
        }

        // Soft-delete: deactivate the role
        const deleted = await db.tenantCustomRole.update({
            where: { id: roleId },
            data: { isActive: false },
        });

        // Clear customRoleId on all affected memberships
        // so they safely fall back to their enum role
        const cleared = await db.tenantMembership.updateMany({
            where: { tenantId: ctx.tenantId, customRoleId: roleId },
            data: { customRoleId: null },
        });

        await logEvent(db, ctx, {
            action: 'CUSTOM_ROLE_DELETED',
            entityType: 'TenantCustomRole',
            entityId: deleted.id,
            details: `Deleted custom role: ${existing.name} (${cleared.count} members reassigned to fallback)`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantCustomRole',
                operation: 'deleted',
                summary: `Deleted custom role: ${existing.name}`,
                metadata: { membersCleared: cleared.count },
            },
        });

        return { deleted, membersCleared: cleared.count };
    });
}

// ─── Bulk Delete (Soft-Delete) Custom Roles ───

/**
 * Bulk soft-delete custom roles. Idempotent + permission-gated identically
 * to {@link deleteCustomRole}: same `assertCanManageMembers` gate, same
 * soft-delete mechanism (deactivate + clear `customRoleId` on affected
 * memberships so they fall back to their enum role).
 *
 * Idempotent over the id set — ids that don't resolve to an ACTIVE role in
 * the calling tenant are silently skipped (never throws for a single bad
 * id). Resolves the whole set with ONE `findMany` (no per-id READ in the
 * loop — the query-shape guard bans N+1), then runs writes-only per role.
 * Emits one audit event per actually-deleted role.
 */
export async function bulkDeleteCustomRole(
    ctx: RequestContext,
    input: { roleIds: string[] },
): Promise<{ deleted: number }> {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, async (db) => {
        // One READ to resolve + filter: only ACTIVE roles in this tenant.
        // Already-deleted (inactive) or foreign ids are skipped.
        const roles = await db.tenantCustomRole.findMany({
            where: {
                id: { in: input.roleIds },
                tenantId: ctx.tenantId,
                isActive: true,
            },
            select: { id: true, name: true },
        });
        if (roles.length === 0) return { deleted: 0 };

        const roleIds = roles.map((r) => r.id);

        // Soft-delete all resolved roles in one write.
        await db.tenantCustomRole.updateMany({
            where: { id: { in: roleIds }, tenantId: ctx.tenantId },
            data: { isActive: false },
        });

        // Writes-only loop (no reads): per-role membership clear + audit so
        // each event carries that role's own reassigned-member count.
        for (const role of roles) {
            const cleared = await db.tenantMembership.updateMany({
                where: { tenantId: ctx.tenantId, customRoleId: role.id },
                data: { customRoleId: null },
            });

            await logEvent(db, ctx, {
                action: 'CUSTOM_ROLE_DELETED',
                entityType: 'TenantCustomRole',
                entityId: role.id,
                details: `Deleted custom role: ${role.name} (${cleared.count} members reassigned to fallback)`,
                detailsJson: {
                    category: 'entity_lifecycle',
                    entityName: 'TenantCustomRole',
                    operation: 'deleted',
                    summary: `Deleted custom role: ${role.name}`,
                    metadata: { membersCleared: cleared.count },
                },
            });
        }

        return { deleted: roles.length };
    });
}

// ─── Assign Custom Role to Member ───

export async function assignCustomRole(
    ctx: RequestContext,
    membershipId: string,
    customRoleId: string | null,
) {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, async (db) => {
        // Verify membership exists in this tenant
        const membership = await db.tenantMembership.findFirst({
            where: {
                id: membershipId,
                tenantId: ctx.tenantId,
                status: 'ACTIVE',
            },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        if (!membership) {
            throw notFound('Membership not found or not active.');
        }

        // If assigning, verify the custom role exists and belongs to this tenant
        if (customRoleId) {
            const customRole = await db.tenantCustomRole.findFirst({
                where: {
                    id: customRoleId,
                    tenantId: ctx.tenantId,
                    isActive: true,
                },
            });
            if (!customRole) {
                throw notFound('Custom role not found or inactive.');
            }
        }

        const oldCustomRoleId = membership.customRoleId;

        const updated = await db.tenantMembership.update({
            where: { id: membershipId },
            data: { customRoleId },
            include: {
                user: { select: { id: true, name: true, email: true } },
                customRole: { select: { id: true, name: true } },
            },
        });

        await logEvent(db, ctx, {
            action: 'MEMBER_CUSTOM_ROLE_CHANGED',
            entityType: 'TenantMembership',
            entityId: updated.id,
            details: customRoleId
                ? `Assigned custom role "${updated.customRole?.name}" to ${membership.user.email}`
                : `Removed custom role from ${membership.user.email} (fallback to ${membership.role})`,
            detailsJson: {
                category: 'status_change',
                entityName: 'TenantMembership',
                fromStatus: oldCustomRoleId ?? 'none',
                toStatus: customRoleId ?? 'none',
            },
        });

        return updated;
    });
}
