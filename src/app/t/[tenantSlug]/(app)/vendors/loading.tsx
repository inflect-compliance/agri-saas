import { getTranslations } from 'next-intl/server';
import {
    SkeletonPageHeader,
    SkeletonFilterToolbar,
    SkeletonDataTable,
} from '@/components/ui/skeleton';

/**
 * Vendors loading skeleton — header + filter toolbar + 7-col table.
 */
export default async function VendorsLoading() {
    const t = await getTranslations('vendors');
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <SkeletonPageHeader />
            <SkeletonFilterToolbar />
            <SkeletonDataTable rows={8} cols={7} />
        </div>
    );
}
