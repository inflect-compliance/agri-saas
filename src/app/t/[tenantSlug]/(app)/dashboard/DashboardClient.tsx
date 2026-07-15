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
import TasksTrendCard from './TasksTrendCard';
import { MarketTrendsWidget } from '@/components/trends/MarketTrendsWidget';

export default function DashboardClient() {
    return (
        <div className="space-y-section">
            {/* ─── Market trends (always shown) ───
                Headline lead-commodity price + sparkline, tapping through to
                the full Trends page. Market data is global; renders a muted
                empty state when the backend has no data. */}
            <MarketTrendsWidget />

            {/* ─── Tasks trendline (always shown) ───
                Daily "created vs completed" farm-task counts over the last
                14 days. Tasks aren't module-gated, so this renders for every
                tenant (empty state when there's no activity). */}
            <TasksTrendCard />

            {/* ─── Agriculture strip (module-gated) ───
                A small "your farm today" row led by the AI field briefing.
                Renders nothing for a tenant with neither the JOURNAL nor
                INVENTORY module enabled. */}
            <AgDashboardStrip />
        </div>
    );
}
