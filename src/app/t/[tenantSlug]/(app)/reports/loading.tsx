import {
    Skeleton,
    SkeletonHeading,
    SkeletonButton,
} from '@/components/ui/skeleton';

/**
 * Reports loading skeleton — shown via Next.js Suspense while
 * the server component fetches report data.
 *
 * R13-PR6 — the skeleton mimics the DataTable primitive's own
 * `bg-bg-default rounded-lg border-border-subtle` card so the
 * transition from skeleton → real DataTable doesn't flash a
 * different shell.
 */
export default function ReportsLoading() {
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label="Loading reports">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-compact">
                <SkeletonHeading className="w-48" />
                <div className="flex flex-wrap gap-tight">
                    <SkeletonButton />
                    <SkeletonButton />
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex gap-tight">
                <Skeleton className="h-10 w-32 rounded-lg" />
                <Skeleton className="h-10 w-32 rounded-lg" />
            </div>

            {/* Table skeleton — mirrors the DataTable primitive's own
                outer card so the swap to live data doesn't flash. */}
            <div className="bg-bg-default rounded-lg border border-border-subtle overflow-hidden">
                {/* Header */}
                <div className="h-12 bg-bg-default/50 border-b border-border-subtle" />
                {/* Rows */}
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-12 border-b border-border-subtle px-4 flex items-center gap-default">
                        <Skeleton className="h-4 w-1/4 rounded" />
                        <Skeleton className="h-4 w-1/3 rounded" />
                        <Skeleton className="h-4 w-1/6 rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
}
