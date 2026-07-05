import {
    Skeleton,
    SkeletonHeading,
    SkeletonLine,
    SkeletonButton,
} from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { getTranslations } from 'next-intl/server';

/**
 * Frameworks loading skeleton — title + card grid.
 */
export default async function FrameworksLoading() {
    const t = await getTranslations('frameworks');
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <div className="flex items-center justify-between">
                <SkeletonHeading />
                <SkeletonButton />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-default">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Card className="space-y-compact" key={i}>
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
