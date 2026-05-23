import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listAudits, createAudit } from '@/app-layer/usecases/audit';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateAuditSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { LIST_BACKFILL_CAP, applyBackfillCap } from '@/lib/list-backfill-cap';
import { recordListPageRowCount } from '@/lib/observability/list-page-metrics';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    // PR-5 — backfill cap.
    const audits = await listAudits(ctx, { take: LIST_BACKFILL_CAP + 1 });
    const result = applyBackfillCap(audits);
    // PR-6 — row-count observability.
    recordListPageRowCount({
        entity: 'audits',
        count: result.rows.length,
        truncated: result.truncated,
        tenantId: ctx.tenantId,
    });
    return jsonResponse(result);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateAuditSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const audit = await createAudit(ctx, body);
    return jsonResponse(audit, { status: 201 });
}));
