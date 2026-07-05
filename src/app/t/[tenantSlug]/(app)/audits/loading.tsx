import {
    SkeletonPageHeader,
    SkeletonDataTable,
    SkeletonCard,
} from '@/components/ui/skeleton';
import { getTranslations } from 'next-intl/server';

/**
 * Audits loading skeleton — header + cycles/packs list.
 */
export default async function AuditsLoading() {
    const t = await getTranslations('audits');
    return (
        <div role="status" aria-live="polite" className="space-y-section animate-fadeIn" aria-busy="true" aria-label={t('loadingAria')}>
            <SkeletonPageHeader />

            {/* Cycles section */}
            <SkeletonCard lines={2} />

            {/* Packs table */}
            <SkeletonDataTable rows={6} cols={6} />
        </div>
    );
}
