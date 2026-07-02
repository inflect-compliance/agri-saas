'use client';

/**
 * Smart-nav — navigation referrer tracker (ported from IC RQ4-3).
 *
 * Mounts once at the tenant app layout. Subscribes to `usePathname()` and
 * records the previously-rendered pathname into per-tab `sessionStorage`
 * on every transition. The `<BackAffordance>` primitive reads from the
 * same slot via `usePreviousPath`.
 *
 * Cross-tenant safety: when the user navigates from tenant A to tenant B
 * the tracker clears tenant A's previous-path slot so a stale tenant-A
 * path can never surface inside tenant B.
 *
 * Render output: none — this component is a side-effect mount only.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
    clearPreviousPath,
    tenantSlugFromPath,
    writePreviousPath,
} from '@/lib/nav/usePreviousPath';

export function NavigationTracker() {
    const pathname = usePathname();
    const lastPathnameRef = useRef<string | null>(null);
    const lastTenantRef = useRef<string | null>(null);

    useEffect(() => {
        if (!pathname) return;

        const tenant = tenantSlugFromPath(pathname);
        const prevPath = lastPathnameRef.current;
        const prevTenant = lastTenantRef.current;

        // First render: no previous path yet — just record the current
        // pathname/tenant for the NEXT transition.
        if (prevPath === null) {
            lastPathnameRef.current = pathname;
            lastTenantRef.current = tenant;
            return;
        }

        // Cross-tenant transition: clear the OUTGOING tenant's slot so
        // tenant-A paths can't leak into tenant-B's back affordance.
        if (prevTenant && prevTenant !== tenant) {
            clearPreviousPath(prevTenant);
        }

        // Write the OUTGOING pathname into the INCOMING tenant's slot,
        // but only if both ends are in the same tenant. Without that
        // guard the back affordance would point at a foreign-tenant URL.
        if (tenant && prevTenant === tenant) {
            writePreviousPath(tenant, prevPath);
        }

        lastPathnameRef.current = pathname;
        lastTenantRef.current = tenant;
    }, [pathname]);

    return null;
}

export default NavigationTracker;
