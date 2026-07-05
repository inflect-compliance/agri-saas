import {
    SkeletonPageHeader,
    SkeletonFilterToolbar,
    SkeletonDataTable,
} from '@/components/ui/skeleton';
import { getTranslations } from 'next-intl/server';

/**
 * Evidence loading skeleton — header + filter toolbar + 7-col table.
 */
export default async function EvidenceLoading() {
    const t = await getTranslations('evidence');
    return (
        <div className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <SkeletonPageHeader />
            <SkeletonFilterToolbar />
            <SkeletonDataTable rows={8} cols={7} />
        </div>
    );
}
