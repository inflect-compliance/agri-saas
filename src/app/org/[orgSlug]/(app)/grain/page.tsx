import { notFound } from 'next/navigation';

import { getOrgCtx } from '@/app-layer/context';
import { getPortfolioGrainSummary } from '@/app-layer/usecases/portfolio-grain';
import { toPlainJson } from '@/lib/server/to-plain-json';

import { PortfolioGrainClient } from './PortfolioGrainClient';

/**
 * Enterprise-grain — org portfolio grain dashboard (cross-tenant).
 *
 * Aggregates the GRAIN-module figures (contracted volume, harvested
 * yield, activity cost, bin storage) across every child farm tenant of
 * the organization into one portfolio view. The fan-out runs each
 * per-tenant aggregate inside `withTenantDb(tenantId, …)` (RLS-bound) —
 * see `getPortfolioGrainSummary` for the security invariant.
 *
 * Read access is gated by `canViewPortfolio` (enforced inside the
 * usecase). A child tenant with the GRAIN module off, no grain data, or
 * no auto-provisioned AUDITOR membership contributes zeros.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{ orgSlug: string }>;
}

export default async function OrgGrainPage({ params }: PageProps) {
    const { orgSlug } = await params;

    let ctx;
    try {
        ctx = await getOrgCtx({ orgSlug });
    } catch {
        notFound();
    }

    const summary = await getPortfolioGrainSummary(ctx);

    // Server→client RSC boundary — see `toPlainJson` for rationale
    // (strips non-serialisable values; numbers are already plain after
    // the usecase's Decimal→number conversion).
    return <PortfolioGrainClient summary={toPlainJson(summary)} />;
}
