import { PrismaTx } from '@/lib/db-context';
import { RequestContext } from '../types';
import { ModuleKey } from '@prisma/client';

/**
 * TenantModuleSettings repository — one row per tenant (tenantId unique),
 * tenant-scoped (RLS). Absence of a row means "all modules enabled".
 */
export class ModuleSettingsRepository {
    static async get(db: PrismaTx, ctx: RequestContext) {
        return db.tenantModuleSettings.findUnique({ where: { tenantId: ctx.tenantId } });
    }

    static async upsert(db: PrismaTx, ctx: RequestContext, enabledModules: ModuleKey[]) {
        return db.tenantModuleSettings.upsert({
            where: { tenantId: ctx.tenantId },
            create: { tenantId: ctx.tenantId, enabledModules },
            update: { enabledModules },
        });
    }
}
