import {
    Skeleton,
    SkeletonHeading,
    SkeletonButton,
} from '@/components/ui/skeleton';
import { cardVariants } from '@/components/ui/card-variants';
import { cn } from '@dub/utils';

/**
 * Reports loading skeleton — shown via Next.js Suspense while
 * the server component fetches report data.
 */
export default function ReportsLoading() {
    return (
        <div className="animate-pulse space-y-section" aria-busy="true" aria-label="Loading reports">
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

            {/* Table skeleton */}
            <div className={cn(cardVariants({ density: 'none' }), 'overflow-hidden')}>
                {/* Header */}
                <div className="h-12 bg-bg-default/50 border-b border-border-default/50" />
                {/* Rows */}
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-12 border-b border-border-default/50 px-4 flex items-center gap-default">
                        <Skeleton className="h-4 w-1/4 rounded" />
                        <Skeleton className="h-4 w-1/3 rounded" />
                        <Skeleton className="h-4 w-1/6 rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
}
