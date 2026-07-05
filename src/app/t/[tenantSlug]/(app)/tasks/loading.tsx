import {
    SkeletonPageHeader,
    SkeletonFilterBar,
    SkeletonDataTable,
} from '@/components/ui/skeleton';
import { getTranslations } from 'next-intl/server';

/**
 * Tasks loading skeleton — header + filters + 8-col table.
 */
export default async function TasksLoading() {
    const t = await getTranslations('tasks');
    return (
        <div role="status" aria-live="polite" className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingLabel')}>
            <SkeletonPageHeader />
            <SkeletonFilterBar />
            <SkeletonDataTable rows={10} cols={8} />
        </div>
    );
}
