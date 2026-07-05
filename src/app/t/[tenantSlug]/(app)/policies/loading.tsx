import { getTranslations } from 'next-intl/server';
import {
    SkeletonPageHeader,
    SkeletonFilterToolbar,
    SkeletonDataTable,
} from '@/components/ui/skeleton';

/**
 * Policies loading skeleton — header + filter toolbar + 6-col table.
 */
export default async function PoliciesLoading() {
    const t = await getTranslations('policies');
    return (
        <div role="status" aria-live="polite" className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <SkeletonPageHeader />
            <SkeletonFilterToolbar />
            <SkeletonDataTable rows={8} cols={6} />
        </div>
    );
}
