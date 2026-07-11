'use client';

/**
 * Roadmap-6 P3 — mounts the per-tenant persistent SWR cache.
 *
 * Wraps the app in a single `<SWRConfig>` whose `provider` is a
 * disk-backed Map (see `@/lib/swr/persistent-cache`). Net effect: a PWA
 * relaunch paints every list from the on-device cache instantly and
 * only revalidates in the background — no more cold-start full-farm
 * refetch over rural LTE.
 *
 * Tenant isolation — the cache bucket is namespaced by the active
 * tenant slug (parsed from the `/t/<slug>/…` pathname). `SWRConfig` is
 * KEYED by that namespace, so navigating between tenants remounts it
 * with a fresh Map hydrated from THAT tenant's bucket — one tenant's
 * cached rows can never surface under another on a shared device.
 * Routes with no tenant (`/login`, `/tenants`, …) use a `global`
 * bucket.
 *
 * The provider factory is fully feature-detected and never throws, so
 * SSR and browsers without localStorage / IndexedDB degrade to a plain
 * in-memory cache (exactly today's behaviour) rather than crashing.
 */

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { SWRConfig } from 'swr';
import { createPersistentCacheProvider } from '@/lib/swr/persistent-cache';

/** Extract the tenant slug from a `/t/<slug>/…` path, else `global`. */
export function tenantNamespaceFromPath(pathname: string | null): string {
    if (!pathname) return 'global';
    const match = /^\/t\/([^/]+)/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : 'global';
}

export function SWRPersistenceProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const namespace = tenantNamespaceFromPath(pathname);

    // Recreate the provider (and thus re-hydrate from the correct
    // bucket) only when the tenant namespace changes — never on ordinary
    // in-tenant navigation. SWR calls this factory once per SWRConfig
    // mount; the `key` below forces that remount on a tenant switch.
    const provider = useMemo(
        () => () => createPersistentCacheProvider({ namespace }),
        [namespace],
    );

    return (
        <SWRConfig key={namespace} value={{ provider }}>
            {children}
        </SWRConfig>
    );
}
