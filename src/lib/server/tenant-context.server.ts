/**
 * Server-side tenant context resolver.
 *
 * This module provides RSC-safe (React Server Component) tenant resolution
 * that can be used in layouts, pages, and server-side data loaders WITHOUT
 * depending on client-only hooks like useTenantApiUrl().
 *
 * Key design decisions:
 *   - Returns PLAIN serializable objects (no Prisma model types)
 *   - No 'use client' dependency — safe for server components
 *   - Reuses the authoritative resolveTenantContext() for membership/permission checks
 *   - Separate lightweight resolveTenantBySlug() for cases where auth isn't established
 *
 * @module server/tenant-context.server
 */
import prisma from '@/lib/prisma';
import { resolveTenantContext } from '@/lib/tenant-context';
import { notFound } from '@/lib/errors/types';
import type { Role } from '@prisma/client';
import type { Permissions } from '@/lib/tenant-context';
import type { PermissionSet } from '@/lib/permissions';

// ─── Public types (serializable — safe for RSC boundaries) ───

/**
 * Lightweight tenant record — no Prisma model, just plain data.
 */
export interface TenantRecord {
    /** The tenant's internal CUID */
    id: string;
    /** URL-safe slug used in routing (e.g. "acme-corp") */
    slug: string;
    /** Display name */
    name: string;
}

/**
 * Full server-side tenant context, including the requesting user's
 * role and computed permissions within the tenant.
 *
 * This is a plain serializable object — safe to pass as props across
 * RSC → client component boundaries.
 */
export interface TenantServerContext {
    /** Tenant identifiers */
    tenant: TenantRecord;
    /** The user's role within this tenant */
    role: Role;
    /** Coarse-grained permission flags */
    permissions: Permissions;
    /** Fine-grained UI permission set */
    appPermissions: PermissionSet;
}

// ─── Resolvers ───

/**
 * Resolves a tenant record by its URL slug.
 *
 * Use this when you need the tenant identity but do NOT have (or need)
 * the requesting user's session — e.g., building meta tags or breadcrumbs.
 *
 * Throws AppError (NOT_FOUND) if the slug does not match any tenant.
 *
 * @param slug - The tenant URL slug (e.g. "acme-corp")
 * @returns Plain TenantRecord (id, slug, name)
 */
export async function resolveTenantBySlug(slug: string): Promise<TenantRecord> {
    const tenant = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true },
    });
    if (!tenant) {
        throw notFound('Tenant not found');
    }
    return tenant;
}

/**
 * Resolves full server-side tenant context for an authenticated user.
 *
 * This is the primary resolver for RSC pages and layouts. It:
 * 1. Looks up the tenant by slug
 * 2. Verifies the user's membership (active, not deactivated/removed)
 * 3. Computes role-based permissions
 *
 * Returns a plain serializable object — no Prisma model types.
 *
 * Throws:
 * - AppError NOT_FOUND if the tenant doesn't exist
 * - AppError FORBIDDEN if the user has no active membership
 *
 * @example
 * ```ts
 * // In a server component or layout:
 * const session = await auth();
 * const ctx = await getTenantServerContext({
 *   tenantSlug: params.tenantSlug,
 *   userId: session.user.id,
 * });
 * // ctx.tenant.id, ctx.role, ctx.permissions, ctx.appPermissions
 * ```
 */
export async function getTenantServerContext(params: {
    tenantSlug: string;
    userId: string;
}): Promise<TenantServerContext> {
    // Delegate to the authoritative resolver which handles:
    // - Tenant lookup
    // - Membership verification
    // - Deactivation/removal checks
    // - Permission computation
    const ctx = await resolveTenantContext(
        { tenantSlug: params.tenantSlug },
        params.userId,
    );

    // Map to a plain serializable shape (strip Prisma model internals)
    return {
        tenant: {
            id: ctx.tenant.id,
            slug: ctx.tenant.slug,
            name: ctx.tenant.name,
        },
        role: ctx.role,
        permissions: ctx.permissions,
        appPermissions: ctx.appPermissions,
    };
}
