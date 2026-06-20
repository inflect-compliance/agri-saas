'use client';

import { useTenantSWR } from '@/lib/hooks/use-tenant-swr';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { CACHE_KEYS } from '@/lib/swr-keys';
import type { AgDashboardPayload } from '@/app-layer/usecases/ag-dashboard';

import FirstRunCard from './FirstRunCard';
import SeasonRecapCard from './SeasonRecapCard';
import RecentJournalCard from './RecentJournalCard';
import LowStockCard from './LowStockCard';
import MyFarmTasksCard from './MyFarmTasksCard';
import CertificationSchemeCard from './CertificationSchemeCard';
import AchievementsCard from './AchievementsCard';

/**
 * Agriculture dashboard strip — a small "your farm today" row of cards
 * rendered ABOVE the fixed GRC executive cards on the tenant dashboard.
 *
 * Gating is module-driven, read from the `enabledModules` the
 * `/dashboard/ag` payload carries (the tenant's enabled set isn't on the
 * client `TenantContext`, so the data source threads it through):
 *
 *   - Journal card  → only when the JOURNAL module is enabled.
 *   - Low-stock card → only when the INVENTORY module is enabled.
 *   - My-tasks card → always (Tasks is not module-gated).
 *
 * If NEITHER ag module is enabled the whole strip renders nothing — a
 * pure-GRC tenant sees no farm row at all. While the first request is in
 * flight (no `data` yet) the strip also renders nothing, so it never
 * flashes empty chrome on a GRC tenant.
 */
export default function AgDashboardStrip() {
    const href = useTenantHref();
    const { data, mutate } = useTenantSWR<AgDashboardPayload>(CACHE_KEYS.dashboard.ag());

    if (!data) return null;

    // Defensive: a malformed / partial cache payload (e.g. an SWR key
    // collision in tests, or a future error-shape from the endpoint) can
    // leave `enabledModules` undefined even when `data` is truthy. Treat a
    // missing list as "no ag modules" → the strip renders nothing, the same
    // safe default as the no-data branch above.
    const journalOn = data.enabledModules?.includes('JOURNAL') ?? false;
    const inventoryOn = data.enabledModules?.includes('INVENTORY') ?? false;
    // Certification card shows when the module is on AND the payload carries
    // a top-scheme readiness reading (a tenant with no AG_SCHEME yields null).
    const certificationOn = (data.enabledModules?.includes('CERTIFICATION') ?? false) && !!data.certification;

    // The strip exists only for ag tenants. With no core ag module enabled
    // (journal / inventory) AND no certification reading, render nothing —
    // the farm row is invisible for pure-GRC.
    if (!journalOn && !inventoryOn && !certificationOn && !data.achievements) return null;

    return (
        <div className="space-y-default">
            {/* Guided first-run ring — self-hides once the farm is set up
                or the operator dismisses it (see FirstRunCard). */}
            <FirstRunCard payload={data} onChanged={() => { void mutate(); }} />
            {/* Shareable season recap + "Year on the farm" PDF — self-hides
                until there's something to recap. */}
            <SeasonRecapCard />
            <div
                id="ag-dashboard-strip"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-default"
            >
            {journalOn && (
                <RecentJournalCard href={href('/journal')} items={data.recentJournal} />
            )}
            {inventoryOn && (
                <LowStockCard href={href('/inventory')} items={data.lowStock} />
            )}
            {certificationOn && data.certification && (
                <CertificationSchemeCard href={href('/schemes')} certification={data.certification} />
            )}
            <MyFarmTasksCard href={href('/farm-tasks')} items={data.myTasks} />
            {data.achievements && <AchievementsCard achievements={data.achievements} />}
            </div>
        </div>
    );
}
