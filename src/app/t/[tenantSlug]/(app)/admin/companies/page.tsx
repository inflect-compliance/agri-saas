import { notFound } from 'next/navigation';
import { getTenantCtx } from '@/app-layer/context';
import { isPlatformTenant } from '@/lib/auth/platform-support';
import { CompaniesAdminClient } from './CompaniesAdminClient';

/**
 * Platform-support console — the supplier catalogue (#12).
 *
 * Same gate as the promotions page: `notFound()` off-platform, so the console's
 * existence isn't disclosed to other tenants. This surface shows DECRYPTED
 * contact details, which makes the gate load-bearing rather than cosmetic.
 */
export default async function CompaniesAdminPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });

    if (!isPlatformTenant(tenantSlug) || !ctx.permissions.canAdmin) notFound();

    return <CompaniesAdminClient tenantSlug={tenantSlug} />;
}
