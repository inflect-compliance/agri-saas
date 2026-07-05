import {
    SkeletonPageHeader,
    SkeletonKpiGrid,
    SkeletonFilterToolbar,
    SkeletonDataTable,
} from '@/components/ui/skeleton';
import { getTranslations } from 'next-intl/server';

/**
 * Risks loading skeleton — header + 4 KPI cards + filter toolbar + 8-col table.
 * Matches the real RisksClient layout for seamless streaming.
 */
export default async function RisksLoading() {
    const t = await getTranslations('riskManager');
    return (
        <div role="status" aria-live="polite" className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <SkeletonPageHeader />
            <SkeletonKpiGrid count={4} />
            <SkeletonFilterToolbar />
            <SkeletonDataTable rows={8} cols={8} />
        </div>
    );
}
