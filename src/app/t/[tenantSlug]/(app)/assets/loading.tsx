import {
    SkeletonPageHeader,
    SkeletonDataTable,
} from '@/components/ui/skeleton';
import { getTranslations } from 'next-intl/server';

/**
 * Assets loading skeleton — header + table.
 */
export default async function AssetsLoading() {
    const t = await getTranslations('assets');
    return (
        <div role="status" aria-live="polite" className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <SkeletonPageHeader />
            <SkeletonDataTable rows={8} cols={6} />
        </div>
    );
}
