import { getTenantCtx } from '@/app-layer/context';
import { requireModule } from '@/lib/security/require-module';

/**
 * Exchange route-group gate. Redirects to the dashboard unless the tenant
 * has the EXCHANGE module enabled (network-effect marketplace).
 */
export default async function ExchangeGroupLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    await requireModule(ctx, 'EXCHANGE');
    return <>{children}</>;
}
