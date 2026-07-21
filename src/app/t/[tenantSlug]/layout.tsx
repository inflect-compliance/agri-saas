import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { auth } from '@/auth';
import { getTenantServerContext } from '@/lib/server/tenant-context.server';
import { TenantProvider } from '@/lib/tenant-context-provider';
import { getTenantPlan, getAvailableModulesForTenant } from '@/lib/entitlements-server';
import { hasUpcomingAgriEvents } from '@/app-layer/usecases/agri-events';
import { hasVisiblePromotions } from '@/app-layer/usecases/promotions';

/**
 * This layout depends on auth cookies and database queries — it can never be statically generated.
 * Without this, Next.js attempts static path generation and crashes during compilation.
 */
export const dynamic = 'force-dynamic';

/**
 * Tenant-scoped layout.
 * Resolves tenant context from URL slug and wraps children with TenantProvider.
 * If user has no membership → 404.
 *
 * ARCHITECTURAL NOTE: This layout is the security boundary for tenant permission isolation.
 * It uses noStore() + force-dynamic to guarantee per-request freshness — permissions are
 * NEVER served from a stale cache. The client-side SidebarNav filter is a defense-in-depth
 * layer, not the primary gate.
 */
export default async function TenantLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ tenantSlug: string }>;
}) {
    // Prevent Next.js from caching this layout's output between different user sessions.
    // Without this, an admin's server-rendered layout can be stale-served to a reader user.
    noStore();

    const { tenantSlug } = await params;

    // Get current user session
    const session = await auth();
    if (!session?.user?.id) {
        // Middleware should have caught this, but guard here too
        notFound();
    }

    // Resolve tenant context server-side (throws notFound/forbidden if invalid)
    let serverCtx;
    try {
        serverCtx = await getTenantServerContext({
            tenantSlug,
            userId: session.user.id,
        });
    } catch {
        notFound();
    }

    // #15 — the agri-events probe joins the existing Promise.all so it costs no
    // extra latency. It is memoised in-process (the answer is identical for
    // every tenant), so this is not a per-navigation query.
    const [planRaw, availableModules, agriEventsAvailable, promotionsAvailable] =
        await Promise.all([
            getTenantPlan(serverCtx.tenant.id),
            getAvailableModulesForTenant(serverCtx.tenant.id),
            hasUpcomingAgriEvents(),
            // #12 — same deal for the promotions catalogue: memoised in-process,
            // identical for every tenant, joins the existing Promise.all so it
            // costs no extra latency.
            hasVisiblePromotions(),
        ]);
    const plan = planRaw ?? undefined;

    return (
        <TenantProvider value={{
            tenantId: serverCtx.tenant.id,
            tenantSlug: serverCtx.tenant.slug,
            tenantName: serverCtx.tenant.name,
            currencySymbol: serverCtx.tenant.currencySymbol,
            role: serverCtx.role,
            plan,
            availableModules,
            agriEventsAvailable,
            promotionsAvailable,
            permissions: serverCtx.permissions,
            appPermissions: serverCtx.appPermissions,
        }}>
            {children}
        </TenantProvider>
    );
}

