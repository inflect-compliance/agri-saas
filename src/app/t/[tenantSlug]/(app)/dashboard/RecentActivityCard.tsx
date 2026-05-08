import { formatDateTime } from '@/lib/format-date';
import { getTenantCtx } from '@/app-layer/context';
import { runInTenantContext } from '@/lib/db-context';
import { DashboardRepository } from '@/app-layer/repositories/DashboardRepository';
import { Heading } from '@/components/ui/typography';
import { Card } from '@/components/ui/card';

interface RecentActivityCardProps {
    tenantSlug: string;
    label: string;
    noActivityLabel: string;
}

/**
 * Async server component that independently fetches and renders recent activity.
 * Designed to be wrapped in <Suspense> so the rest of the dashboard streams immediately
 * while this potentially slower query completes.
 */
export default async function RecentActivityCard({
    tenantSlug,
    label,
    noActivityLabel,
}: RecentActivityCardProps) {
    const ctx = await getTenantCtx({ tenantSlug });

    const recentActivity = await runInTenantContext(ctx, async (db) => {
        return DashboardRepository.getRecentActivity(db, ctx);
    });

    return (
        <Card>
            <Heading level={3} className="mb-3" id="recent-activity-heading">
                {label}
            </Heading>
            {/*
              tabIndex=0 + role=region + aria-labelledby satisfies axe's
              `scrollable-region-focusable` rule (WCAG 2.1.1 Keyboard).
              Without these, keyboard-only users cannot scroll the
              activity list — the rule is "serious" because the
              content is hidden behind the overflow.
            */}
            <div
                className="space-y-2 max-h-40 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
                tabIndex={0}
                role="region"
                aria-labelledby="recent-activity-heading"
            >
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {recentActivity.map((log: any) => (
                    <div key={log.id} className="flex flex-col sm:flex-row items-start gap-1 sm:gap-2 text-xs">
                        <span className="text-content-subtle whitespace-nowrap">{formatDateTime(log.createdAt)}</span>
                        <span className="text-content-muted">
                            <span className="text-content-default font-medium">{log.user?.name}</span>{' '}
                            {log.action.toLowerCase()} {log.entity.toLowerCase()}
                        </span>
                    </div>
                ))}
                {recentActivity.length === 0 && <p className="text-content-subtle text-xs">{noActivityLabel}</p>}
            </div>
        </Card>
    );
}
