/**
 * Farm dashboard — client shell.
 *
 * The dashboard was trimmed to the farm essentials: the guided onboarding
 * banner and the "your farm today" ag strip (which leads with the AI field
 * briefing). The compliance-era surfaces (risk / evidence KPI tiles, the
 * compliance-trend charts, the next-best-action "readiness" card), the
 * low-stock card, and the recent-activity feed were all removed, as was the
 * "Compliance Dashboard" masthead — the server `page.tsx` greeting header is
 * the sole masthead now.
 *
 * This client shell does no data fetching of its own; each child card owns
 * its own SWR read.
 */
'use client';

import OnboardingBanner from '@/components/onboarding/OnboardingBanner';

import AgDashboardStrip from './AgDashboardStrip';

export default function DashboardClient() {
    return (
        <div className="space-y-section">
            <OnboardingBanner />

            {/* ─── Agriculture strip (module-gated) ───
                A small "your farm today" row led by the AI field briefing.
                Renders nothing for a tenant with neither the JOURNAL nor
                INVENTORY module enabled. */}
            <AgDashboardStrip />
        </div>
    );
}
