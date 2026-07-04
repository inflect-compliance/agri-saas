import { auth } from '@/auth';
import { getTenantCtx } from '@/app-layer/context';
import { getHomeGreeting } from '@/app-layer/usecases/home-greeting';

import DashboardClient from './DashboardClient';
import GreetingHeader from './GreetingHeader';

export const dynamic = 'force-dynamic';

/**
 * Executive Dashboard — server shell.
 *
 * The dashboard is a thin server shell: this server component fetches the
 * greeting + session once on every navigation, so the first paint contains
 * real data — no loading flash — then hands off to the `DashboardClient`
 * which owns the card composition.
 *
 * The farm dashboard is onboarding + the "your farm today" ag strip (which
 * now leads with the AI field briefing). The compliance-era KPI / trend /
 * readiness payloads, the low-stock card, and the recent-activity feed have
 * all been removed.
 */
export default async function DashboardPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });

    const [greeting, session] = await Promise.all([
        getHomeGreeting(ctx),
        auth(),
    ]);

    return (
        <div className="space-y-section">
            <GreetingHeader
                name={session?.user?.name ?? null}
                avatarUrl={session?.user?.image ?? null}
                data={greeting}
            />
            <DashboardClient />
        </div>
    );
}
