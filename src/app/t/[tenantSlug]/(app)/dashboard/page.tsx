import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

import { auth } from '@/auth';
import { getTenantCtx } from '@/app-layer/context';
import { getExecutiveDashboard } from '@/app-layer/usecases/dashboard';
import { getRiskMatrixConfig } from '@/app-layer/usecases/risk-matrix-config';
import { getHomeGreeting } from '@/app-layer/usecases/home-greeting';
import {
    getComplianceTrends,
    type TrendPayload,
} from '@/app-layer/usecases/compliance-trends';

import DashboardClient from './DashboardClient';
import GreetingHeader from './GreetingHeader';
import RecentActivityCard from './RecentActivityCard';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/**
 * Executive Dashboard — server shell.
 *
 * After Epic 69 the dashboard is a hybrid SSR + SWR page:
 *
 *   1. This server component fetches the executive payload + trend
 *      data + risk-matrix config once on every navigation. The
 *      first paint therefore contains real data — no loading flash,
 *      no skeleton-on-cold-cache regression vs. the all-server
 *      version.
 *
 *   2. Those payloads are handed to `<DashboardClient>` as
 *      `initialExec` / `initialTrends`. The client component reads
 *      them through `useTenantSWR(CACHE_KEYS.dashboard.executive())`
 *      with `fallbackData`, so:
 *        - first render uses the server-fetched data synchronously,
 *        - subsequent visits hit SWR cache,
 *        - tab focus / network reconnect trigger a background
 *          refetch with no UI flash (the hook keeps previous data),
 *        - any future mutation site can call
 *          `mutate(CACHE_KEYS.dashboard.executive())` to refresh
 *          this card stack precisely — no `router.refresh()` needed.
 *
 *   3. `RecentActivityCard` stays a server component (no API route
 *      yet). It's rendered HERE and passed as `children` to
 *      `<DashboardClient>` so its server boundary survives the
 *      client-component edge.
 *
 * Pre-Epic-69 this file was ~500 lines of inline JSX + a pair of
 * Suspense-streamed async wrappers. The new shape is intentionally
 * boring — fetch on the server, hand off to the client. Future
 * pages adopting the SWR pattern follow the same recipe.
 */
export default async function DashboardPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });

    const [exec, matrixConfig, greeting, session] = await Promise.all([
        getExecutiveDashboard(ctx),
        getRiskMatrixConfig(ctx),
        getHomeGreeting(ctx),
        auth(),
    ]);

    // Trend snapshot is best-effort. A daily-snapshot row may not
    // exist for the first few days of a fresh tenant — the client
    // renders the empty state when `trends.daysAvailable < 2`, so we
    // pass `null` rather than crashing the whole page on a transient
    // error.
    let trends: TrendPayload | null = null;
    try {
        trends = await getComplianceTrends(ctx, 30);
    } catch {
        trends = null;
    }

    return (
        <div className="space-y-section">
            <GreetingHeader
                name={session?.user?.name ?? null}
                avatarUrl={session?.user?.image ?? null}
                data={greeting}
            />
            <DashboardClient
                initialExec={exec}
                initialTrends={trends}
                matrixConfig={matrixConfig}
            >
            <Suspense
                fallback={
                    <Card className="space-y-compact">
                        <Skeleton className="h-4 w-full sm:w-32" />
                    </Card>
                }
            >
                <RecentActivityCard
                    tenantSlug={tenantSlug}
                    label="Recent Activity"
                    noActivityLabel="No recent activity"
                />
            </Suspense>
            </DashboardClient>
        </div>
    );
}
