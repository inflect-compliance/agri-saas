import { redirect } from 'next/navigation';
import type { ModuleKey } from '@prisma/client';
import type { RequestContext } from '@/app-layer/types';
import { isModuleAvailable } from '@/app-layer/usecases/modules';
import { recordModuleAccess } from '@/lib/observability/module-metrics';

/**
 * Page/layout module gate (the redirect twin of the API's
 * `assertModuleEnabled`). When the tenant cannot access `moduleKey`
 * (plan-allowed ∧ tenant-enabled), redirect to the tenant dashboard
 * rather than render the gated surface. Use in a route-group
 * `layout.tsx` server component so it covers every nested page in one
 * place:
 *
 *   const ctx = await getTenantCtx({ tenantSlug });
 *   await requireModule(ctx, 'CERTIFICATION');
 */
export async function requireModule(ctx: RequestContext, moduleKey: ModuleKey): Promise<void> {
    // Usage telemetry (module × device) — recorded on every gate call, before
    // the availability check, so attempts to reach a module are counted too.
    await recordModuleAccess(moduleKey);
    if (!(await isModuleAvailable(ctx, moduleKey))) {
        redirect(`/t/${ctx.tenantSlug}/dashboard`);
    }
}
