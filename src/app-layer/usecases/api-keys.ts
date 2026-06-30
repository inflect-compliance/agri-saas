/**
 * API Key Management Usecases
 *
 * Admin-only operations for creating, listing, and revoking API keys.
 * All mutations require ADMIN via assertCanManageMembers.
 *
 * @module usecases/api-keys
 */
import { RequestContext } from '../types';
import { assertCanManageMembers, assertCanViewAdminSettings } from '../policies/admin.policies';
import { logEvent } from '../events/audit';
import { runInTenantContext } from '@/lib/db-context';
import { notFound, badRequest } from '@/lib/errors/types';
import { generateApiKey, validateScopes } from '@/lib/auth/api-key-auth';

// ─── List API Keys ───

export async function listApiKeys(ctx: RequestContext) {
    assertCanViewAdminSettings(ctx);

    return runInTenantContext(ctx, (db) =>
        db.tenantApiKey.findMany({
            where: { tenantId: ctx.tenantId },
            select: {
                id: true,
                name: true,
                keyPrefix: true,
                scopes: true,
                expiresAt: true,
                revokedAt: true,
                lastUsedAt: true,
                lastUsedIp: true,
                createdById: true,
                createdAt: true,
                createdBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
        })
    );
}

// ─── Create API Key ───

export interface CreateApiKeyInput {
    name: string;
    scopes: string[];
    expiresAt?: string | null;
}

export async function createApiKey(ctx: RequestContext, input: CreateApiKeyInput) {
    assertCanManageMembers(ctx);

    const name = input.name.trim();
    if (!name || name.length > 100) {
        throw badRequest('Key name is required and must be 100 characters or fewer.');
    }

    // Validate scopes
    const scopeErrors = validateScopes(input.scopes);
    if (scopeErrors.length > 0) {
        throw badRequest(`Invalid scopes: ${scopeErrors.join('; ')}`);
    }

    // Parse optional expiry
    let expiresAt: Date | null = null;
    if (input.expiresAt) {
        expiresAt = new Date(input.expiresAt);
        if (isNaN(expiresAt.getTime())) {
            throw badRequest('Invalid expiry date.');
        }
        if (expiresAt <= new Date()) {
            throw badRequest('Expiry date must be in the future.');
        }
    }

    // Generate key
    const { plaintext, keyHash, keyPrefix } = generateApiKey();

    return runInTenantContext(ctx, async (db) => {
        const apiKey = await db.tenantApiKey.create({
            data: {
                tenantId: ctx.tenantId,
                name,
                keyPrefix,
                keyHash,
                scopes: input.scopes,
                expiresAt,
                createdById: ctx.userId,
            },
            select: {
                id: true,
                name: true,
                keyPrefix: true,
                scopes: true,
                expiresAt: true,
                createdAt: true,
            },
        });

        await logEvent(db, ctx, {
            action: 'API_KEY_CREATED',
            entityType: 'TenantApiKey',
            entityId: apiKey.id,
            details: `Created API key: ${name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantApiKey',
                operation: 'created',
                after: { name, scopes: input.scopes, expiresAt: expiresAt?.toISOString() ?? null },
                summary: `Created API key: ${name}`,
            },
        });

        // Return the plaintext key ONLY at creation — never stored, never re-shown
        return {
            ...apiKey,
            plaintext,
        };
    });
}

// ─── Revoke API Key ───

export async function revokeApiKey(ctx: RequestContext, apiKeyId: string) {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, async (db) => {
        const existing = await db.tenantApiKey.findFirst({
            where: { id: apiKeyId, tenantId: ctx.tenantId },
        });

        if (!existing) {
            throw notFound('API key not found.');
        }

        if (existing.revokedAt) {
            throw badRequest('API key is already revoked.');
        }

        const revoked = await db.tenantApiKey.update({
            where: { id: apiKeyId },
            data: { revokedAt: new Date() },
            select: {
                id: true,
                name: true,
                keyPrefix: true,
                revokedAt: true,
            },
        });

        await logEvent(db, ctx, {
            action: 'API_KEY_REVOKED',
            entityType: 'TenantApiKey',
            entityId: revoked.id,
            details: `Revoked API key: ${existing.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantApiKey',
                operation: 'deleted',
                summary: `Revoked API key: ${existing.name}`,
            },
        });

        return revoked;
    });
}

// ─── Bulk Revoke API Keys ───

/**
 * Revoke a set of API keys in one tenant-scoped, idempotent pass.
 *
 * Mirrors {@link revokeApiKey} over a collection of ids: ids that don't
 * resolve (wrong tenant, unknown id) or are already revoked are silently
 * skipped — a single bad id never throws and never aborts the batch.
 *
 * Avoids an N+1 read (no per-id `findFirst` loop): one `findMany` resolves
 * the still-active keys, one `updateMany` sets `revokedAt`, then a
 * writes-only loop emits one audit entry per actually-revoked key.
 */
export async function bulkRevokeApiKey(
    ctx: RequestContext,
    apiKeyIds: string[],
): Promise<{ revoked: number }> {
    assertCanManageMembers(ctx);

    return runInTenantContext(ctx, async (db) => {
        const keys = await db.tenantApiKey.findMany({
            where: {
                id: { in: apiKeyIds },
                tenantId: ctx.tenantId,
                revokedAt: null,
            },
            select: { id: true, name: true },
        });
        if (keys.length === 0) return { revoked: 0 };

        await db.tenantApiKey.updateMany({
            where: {
                id: { in: keys.map((k) => k.id) },
                tenantId: ctx.tenantId,
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });

        for (const key of keys) {
            await logEvent(db, ctx, {
                action: 'API_KEY_REVOKED',
                entityType: 'TenantApiKey',
                entityId: key.id,
                details: `Revoked API key: ${key.name}`,
                detailsJson: {
                    category: 'entity_lifecycle',
                    entityName: 'TenantApiKey',
                    operation: 'deleted',
                    summary: `Revoked API key: ${key.name}`,
                },
            });
        }

        return { revoked: keys.length };
    });
}
