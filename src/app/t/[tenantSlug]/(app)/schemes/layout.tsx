import { getTenantCtx } from '@/app-layer/context';
import { requireModule } from '@/lib/security/require-module';

/**
 * Module gate for the `schemes` (certification schemes) route group.
 *
 * Gated behind the CERTIFICATION module — a tenant that cannot access it
 * (plan below the CERTIFICATION tier, or the module toggled off) is
 * redirected before any page in this group renders, the redirect twin of
 * the API's `assertModuleEnabled`.
 */
export default async function SchemesGroupLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    await requireModule(ctx, 'CERTIFICATION');
    return <>{children}</>;
}
