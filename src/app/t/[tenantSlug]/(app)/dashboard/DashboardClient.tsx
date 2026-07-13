/**
 * Farm dashboard — client shell.
 *
 * The dashboard is trimmed to the farm essentials: the "your farm today" ag
 * strip (which leads with the AI field briefing). The compliance-era surfaces
 * (risk / evidence KPI tiles, the compliance-trend charts, the next-best-action
 * "readiness" card), the low-stock card, the recent-activity feed, AND the
 * guided onboarding "set up your farm" banner were all removed — the server
 * `page.tsx` greeting header is the sole masthead now.
 *
 * This client shell does no data fetching of its own; each child card owns
 * its own SWR read.
 */
'use client';

import AgDashboardStrip from './AgDashboardStrip';

export default function DashboardClient() {
    return (
        <div className="space-y-section">
            {/* ─── Agriculture strip (module-gated) ───
                A small "your farm today" row led by the AI field briefing.
                Renders nothing for a tenant with neither the JOURNAL nor
                INVENTORY module enabled. */}
            <AgDashboardStrip />
        </div>
    );
}
