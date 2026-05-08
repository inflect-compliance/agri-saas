import {
    Skeleton,
    SkeletonHeading,
    SkeletonLine,
    SkeletonButton,
} from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/**
 * Frameworks loading skeleton — title + card grid.
 */
export default function FrameworksLoading() {
    return (
        <div className="space-y-6 animate-fadeIn" aria-busy="true" aria-label="Loading frameworks">
            <div className="flex items-center justify-between">
                <SkeletonHeading />
                <SkeletonButton />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Card className="space-y-3" key={i}>
                        <SkeletonLine className="w-3/4" />
                        <SkeletonLine className="w-full" />
                        <SkeletonLine className="w-1/2" />
                        <Skeleton className="h-2 w-full rounded-full" />
                    </Card>
                ))}
            </div>
        </div>
    );
}
