/**
 * Farm dashboard — client shell.
 *
 * The dashboard was trimmed to the farm essentials: the guided
 * onboarding banner, the "your farm today" ag strip, and the
 * recent-activity feed. The compliance-era surfaces (risk / evidence
 * KPI tiles, the compliance-trend charts, the next-best-action
 * "readiness" card, and the open-field-tasks hero) were removed, as
 * was the "Compliance Dashboard" masthead header — the page's
 * greeting header (rendered by the server `page.tsx`) is the sole
 * masthead now.
 *
 * `RecentActivityCard` stays a Server Component passed in as
 * `children` from `page.tsx` so its server boundary survives the
 * client-component edge.
 */
'use client';

import * as React from 'react';

import OnboardingBanner from '@/components/onboarding/OnboardingBanner';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

import AgDashboardStrip from './AgDashboardStrip';

interface DashboardClientProps {
    /**
     * RecentActivityCard remains a Server Component (no API route
     * yet) and is rendered into the dashboard tree by the parent
     * server page. Passing it through `children` preserves the
     * server boundary.
     */
    children?: React.ReactNode;
}

export default function DashboardClient({ children }: DashboardClientProps) {
    return (
        <div className="space-y-section">
            <OnboardingBanner />

            {/* ─── Agriculture strip (module-gated) ───
                A small "your farm today" row. Renders nothing for a tenant
                with neither the JOURNAL nor INVENTORY module enabled. */}
            <AgDashboardStrip />

            {/* ─── Recent Activity ───
                RecentActivityCard remains a server component; rendered by
                the parent page and passed in here. */}
            {children ?? (
                <Card className="space-y-compact">
                    <Skeleton className="h-4 w-full sm:w-32" />
                    <div className="space-y-tight">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex items-start gap-tight">
                                <Skeleton className="h-3 w-full sm:w-28 shrink-0" />
                                <Skeleton
                                    className={`h-3 ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`}
                                />
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
