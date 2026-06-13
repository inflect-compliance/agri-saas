import { RequestContext } from '../types';
import { ModuleSettingsRepository } from '../repositories/ModuleSettingsRepository';
import { assertCanRead, assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { forbidden } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';
import { ModuleKey } from '@prisma/client';
import { ALL_MODULES, resolveEnabledModules, coerceModuleKeys } from '@/lib/modules';

/**
 * WP-2 — per-tenant module gating. `assertModuleEnabled` is the gate
 * wired at the usecase/route boundary (mirrors `assertCanWrite`). A
 * tenant with no settings row has every module enabled (default), so
 * gating a route is backward-compatible until a tenant restricts.
 */

/** The tenant's effective enabled-module list (default = all). */
export async function getEnabledModules(ctx: RequestContext): Promise<ModuleKey[]> {
    return runInTenantContext(ctx, async (db) => resolveEnabledModules(await ModuleSettingsRepository.get(db, ctx)));
}

/** Admin read of the module settings (+ whether the tenant has customised). */
export async function getModuleSettings(ctx: RequestContext) {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await ModuleSettingsRepository.get(db, ctx);
        return {
            enabledModules: resolveEnabledModules(row),
            customized: Boolean(row),
            allModules: [...ALL_MODULES],
        };
    });
}

/** Admin write — replace the tenant's enabled-module list. */
export async function setEnabledModules(ctx: RequestContext, enabledModules: ModuleKey[]) {
    assertCanAdmin(ctx);
    // Defence-in-depth: drop unknown keys + dedupe (the route's Zod enum
    // is the first gate; this keeps a non-HTTP caller from persisting
    // garbage or duplicate-bloated arrays into the enum[] column).
    const normalized = [...new Set(coerceModuleKeys(enabledModules))];
    return runInTenantContext(ctx, async (db) => {
        const row = await ModuleSettingsRepository.upsert(db, ctx, normalized);
        await logEvent(db, ctx, {
            action: 'TENANT_MODULES_UPDATED',
            entityType: 'TenantModuleSettings',
            entityId: row.id,
            details: `Enabled modules set to: ${normalized.join(', ') || '(none)'}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantModuleSettings',
                operation: 'updated',
                after: { enabledModules: normalized },
                summary: 'Tenant modules updated',
            },
        });
        return { enabledModules: row.enabledModules };
    });
}

export async function isModuleEnabled(ctx: RequestContext, key: ModuleKey): Promise<boolean> {
    return (await getEnabledModules(ctx)).includes(key);
}

/**
 * Throw a generic 403 if `key` is disabled for the tenant. Call after
 * `getTenantCtx` in any route belonging to a gated module. The key is
 * echoed only in the (non-sensitive) error code `module_disabled:<key>`.
 */
export async function assertModuleEnabled(ctx: RequestContext, key: ModuleKey): Promise<void> {
    if (!(await isModuleEnabled(ctx, key))) {
        throw forbidden(`module_disabled: ${key}`);
    }
}
