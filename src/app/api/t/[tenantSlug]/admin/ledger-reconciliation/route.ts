/**
 * Admin API — stock-ledger reconciliation (integrity sweep).
 *
 *   POST  /api/t/:tenantSlug/admin/ledger-reconciliation
 *     Re-walks the tenant's hash-chained stock ledger and reports
 *     integrity. Returns 200 with the verification report ALWAYS —
 *     including when drift is found (`valid: false`); a broken ledger
 *     is a finding to surface, not a 500. The run is audit-logged
 *     (`LEDGER_RECONCILIATION_RUN`) and emits the `ag.operation`
 *     SLO metric whose `failure` outcome drives the
 *     `AgLedgerReconciliationDrift` alert.
 *
 * Gated by `admin.manage` — operator-driven fleet integrity operation
 * (same tier as key-rotation). Rate-limited tighter than the default
 * mutation limit: reconciliation walks the whole chain, so it should
 * not be hammered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withApiErrorHandling } from '@/lib/errors/api';
import { API_KEY_CREATE_LIMIT } from '@/lib/security/rate-limit-middleware';
import { reconcileStockLedger } from '@/app-layer/usecases/inventory';

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        const report = await reconcileStockLedger(ctx);
        return NextResponse.json(
            {
                tenantId: report.tenantId,
                valid: report.valid,
                totalEntries: report.totalEntries,
                firstBreakAt: report.firstBreakAt ?? null,
                firstBreakId: report.firstBreakId ?? null,
                // Balance half — the reconcile now checks both, so the
                // client can show cache drift + negative on-hand, not just
                // chain integrity.
                balanceHealthy: report.balances.healthy,
                lotsChecked: report.balances.lotsChecked,
                driftCount: report.balances.drift.length,
                negativeCount: report.balances.negative.length,
            },
            // A detected break is a 200 report, not an error — the
            // caller needs the payload to triage. The drift signal goes
            // out-of-band via the audit log + the SLO alert.
            { status: 200 },
        );
    }),
    {
        rateLimit: {
            config: API_KEY_CREATE_LIMIT,
            scope: 'ledger-reconciliation',
        },
    },
);
