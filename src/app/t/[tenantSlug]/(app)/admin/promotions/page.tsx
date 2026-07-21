import { notFound } from 'next/navigation';
import { getTenantCtx } from '@/app-layer/context';
import { isPlatformTenant } from '@/lib/auth/platform-support';
import { PromotionsAdminClient } from './PromotionsAdminClient';

/**
 * Platform-support console — the global promotions feed (#12).
 *
 * The `(app)/admin` layout gates on `admin.view`, which every tenant's
 * OWNER/ADMIN holds, so it does NOT deliver the platform restriction. This page
 * adds it.
 *
 * `notFound()` rather than a forbidden page, matching `assertPlatformSupport`:
 * from any other tenant's perspective this console genuinely does not exist,
 * and an "Access denied" screen would confirm there is a global-catalogue
 * surface worth going looking for.
 */
export default async function PromotionsAdminPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });

    if (!isPlatformTenant(tenantSlug) || !ctx.permissions.canAdmin) notFound();

    return <PromotionsAdminClient tenantSlug={tenantSlug} />;
}
