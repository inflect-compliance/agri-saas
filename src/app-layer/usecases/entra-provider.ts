/**
 * EI-1 — tenant Entra-ID provider configuration.
 *
 * Stores the per-tenant `TenantIdentityProvider` row (type = ENTRA_ID) whose
 * `configJson` is the validated `EntraProviderConfig`. One Entra provider per
 * tenant (a fixed `name`). Admin-gated; secrets are masked at the route layer.
 */
import { RequestContext } from '../types';
import { assertCanAdmin } from '../policies/common';
import { logEvent } from '../events/audit';
import { runInTenantContext } from '@/lib/db-context';
import {
    EntraProviderConfigSchema,
    type EntraProviderConfig,
} from '../schemas/entra-provider.schemas';

const ENTRA_PROVIDER_NAME = 'entra-id';

export async function getEntraProvider(ctx: RequestContext) {
    assertCanAdmin(ctx);
    return runInTenantContext(ctx, (db) =>
        db.tenantIdentityProvider.findFirst({
            where: { tenantId: ctx.tenantId, type: 'ENTRA_ID' },
        }),
    );
}

export async function upsertEntraProvider(
    ctx: RequestContext,
    rawConfig: unknown,
): Promise<{ id: string; config: EntraProviderConfig }> {
    assertCanAdmin(ctx);
    const config = EntraProviderConfigSchema.parse(rawConfig);

    return runInTenantContext(ctx, async (db) => {
        const existing = await db.tenantIdentityProvider.findFirst({
            where: { tenantId: ctx.tenantId, type: 'ENTRA_ID' },
            select: { id: true },
        });

        const row = existing
            ? await db.tenantIdentityProvider.update({
                  where: { id: existing.id },
                  data: { configJson: config, emailDomains: config.allowedDomains ?? [] },
              })
            : await db.tenantIdentityProvider.create({
                  data: {
                      tenantId: ctx.tenantId,
                      name: ENTRA_PROVIDER_NAME,
                      type: 'ENTRA_ID',
                      isEnabled: true,
                      isEnforced: false,
                      emailDomains: config.allowedDomains ?? [],
                      configJson: config,
                  },
              });

        await logEvent(db, ctx, {
            action: 'UPDATE',
            entityType: 'TenantIdentityProvider',
            entityId: row.id,
            details: `${existing ? 'Updated' : 'Configured'} Entra ID provider`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantIdentityProvider',
                operation: existing ? 'updated' : 'created',
                after: {
                    type: 'ENTRA_ID',
                    groupClaimMode: config.groupClaimMode,
                    enforceGroupGate: config.enforceGroupGate,
                },
                summary: `Entra ID provider ${existing ? 'updated' : 'configured'}`,
            },
        });

        return { id: row.id, config };
    });
}
