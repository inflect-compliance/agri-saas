import { getTenantCtx } from '@/app-layer/context';
import { requireModule } from '@/lib/security/require-module';

/**
 * Module gate for the `journal` (Земеделски дневник) route group.
 *
 * JOURNAL is a simple-mode core module and FREE-tier, so the plan never
 * denies it — but a tenant CAN toggle it off in TenantModuleSettings, and
 * until now that toggle did nothing to the journal itself: the auto-emission
 * path in `recordInputApplication` honoured it while every CRUD route and
 * page stayed open. This is the page-side half of closing that gap; the API
 * routes assert the same module (the redirect twin of `assertModuleEnabled`).
 */
export default async function JournalGroupLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    await requireModule(ctx, 'JOURNAL');
    return <>{children}</>;
}
