import { getTranslations } from 'next-intl/server';
import { getTenantCtx } from '@/app-layer/context';
import {
    listLedgerReconciliationHistory,
    type LedgerReconciliationRun,
} from '@/app-layer/usecases/inventory';
import { PageHeader } from '@/components/layout/PageHeader';
import { LedgerIntegrityClient } from './LedgerIntegrityClient';

export const dynamic = 'force-dynamic';

/**
 * Admin — Stock Ledger Integrity.
 *
 * The operator surface for the `reconcileStockLedger` usecase: shows
 * the latest integrity verdict, a "Run reconciliation" button (POSTs
 * the admin route, gated `admin.manage`), and the timeline of past
 * runs. History is reconstructed from the `LEDGER_RECONCILIATION_RUN`
 * audit rows — the audit log is the durable record, no separate table.
 *
 * Server component does the history fetch + a role-bound graceful
 * degrade (a member without read access sees an empty timeline rather
 * than an authorization error); the interactive island lives in the
 * client component.
 */
export default async function LedgerIntegrityPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const ctx = await getTenantCtx({ tenantSlug });
    const t = await getTranslations('admin.ledgerIntegrity');

    let history: LedgerReconciliationRun[] = [];
    try {
        history = await listLedgerReconciliationHistory(ctx);
    } catch {
        // Member may lack read access — gracefully degrade to empty.
        history = [];
    }

    const tenantHref = (path: string) => `/t/${tenantSlug}${path}`;

    return (
        <div className="space-y-section animate-fadeIn">
            <PageHeader
                breadcrumbs={[
                    { label: t('breadcrumbDashboard'), href: tenantHref('/dashboard') },
                    { label: t('breadcrumbAdmin'), href: tenantHref('/admin') },
                    { label: t('breadcrumbLedgerIntegrity') },
                ]}
                title={t('title')}
                description={t('description')}
            />

            <LedgerIntegrityClient history={JSON.parse(JSON.stringify(history))} />
        </div>
    );
}
