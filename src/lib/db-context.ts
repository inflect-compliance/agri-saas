import { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import type { RequestContext } from '@/app-layer/types';
import { runWithAuditContext } from './audit-context';

export type PrismaTx = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Runs a function within a Prisma transaction where the Postgres session
 * variable `app.tenant_id` is set to the provided tenantId.
 * 
 * Because RLS policies are FORCED, any query reading/writing to tenant-scoped
 * tables inside this callback will automatically have its results filtered to
 * the specified tenant.
 * 
 * Also binds audit context so the Prisma middleware can correlate writes.
 * 
 * @see runInTenantContext — preferred API for usecases (accepts full RequestContext)
 */
export async function withTenantDb<T>(
    tenantId: string,
    callback: (tx: PrismaTx) => Promise<T>,
    customPrisma?: PrismaClient // used for testing to dependency-inject the client
): Promise<T> {
    const p = customPrisma || prisma;

    // Bind audit context so middleware can access tenantId
    return runWithAuditContext({ tenantId, source: 'api' }, () =>
        p.$transaction(async (tx) => {
            // Drop superuser privileges to ensure RLS policies are enforced
            await tx.$executeRaw`SET LOCAL ROLE app_user`;
            // Use SET LOCAL to scope the variable to the current transaction.
            // It automatically resets when the transaction commits or rolls back.
            // $executeRaw safely parameterizes the value.
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            return callback(tx);
        })
    ) as Promise<T>;
}

/**
 * Preferred usecase-level helper. Accepts a full RequestContext and:
 * 1. Sets `app.tenant_id` for RLS enforcement (via withTenantDb)
 * 2. Sets `app.request_id` for log/audit correlation
 * 3. Binds full audit context (tenantId + userId + requestId) for middleware
 *
 * Usage:
 * ```ts
 * export async function listAssets(ctx: RequestContext) {
 *     return runInTenantContext(ctx, (db) => AssetRepository.list(db, ctx));
 * }
 * ```
 */
export async function runInTenantContext<T>(
    ctx: RequestContext,
    callback: (db: PrismaTx) => Promise<T>,
    options?: { customPrisma?: PrismaClient; timeout?: number; maxWait?: number }
): Promise<T> {
    const p = options?.customPrisma || prisma;
    const txOptions: { timeout?: number; maxWait?: number } = {};
    if (options?.timeout) txOptions.timeout = options.timeout;
    if (options?.maxWait) txOptions.maxWait = options.maxWait;

    // Bind full audit context so middleware can access tenantId, userId, requestId
    return runWithAuditContext(
        {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
            source: 'api',
        },
        () =>
            p.$transaction(async (tx) => {
                await tx.$executeRaw`SET LOCAL ROLE app_user`;
                await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
                await tx.$executeRaw`SELECT set_config('app.request_id', ${ctx.requestId}, true)`;
                return callback(tx);
            }, txOptions)
    ) as Promise<T>;
}


/**
 * Executes a callback with the global Prisma Client, bypassing RLS.
 * Use this SAFELY and specifically for unauthenticated public routes 
 * where tenant context cannot be established (e.g. share links).
 */
export async function runInGlobalContext<T>(
    callback: (db: PrismaTx) => Promise<T>,
    customPrisma?: PrismaClient
): Promise<T> {
    return callback(customPrisma || prisma);
}
