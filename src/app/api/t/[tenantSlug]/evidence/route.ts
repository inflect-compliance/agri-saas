import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listEvidence, listEvidencePaginated, createEvidence, listEvidenceWithDeleted } from '@/app-layer/usecases/evidence';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateEvidenceSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { normalizeQ } from '@/lib/filters/query-helpers';
import { jsonResponse } from '@/lib/api-response';
import { LIST_BACKFILL_CAP, applyBackfillCap } from '@/lib/list-backfill-cap';
import { recordListPageRowCount } from '@/lib/observability/list-page-metrics';

const EvidenceQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
    type: z.string().optional(),
    status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
    controlId: z.string().optional(),
    q: z.string().optional().transform(normalizeQ),
    archived: z.enum(['true', 'false']).optional(),
    expiring: z.enum(['true', 'false']).optional(),
    includeDeleted: z.enum(['true', 'false']).optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const query = EvidenceQuerySchema.parse(sp);

    if (query.includeDeleted === 'true') {
        const evidence = await listEvidenceWithDeleted(ctx);
        return jsonResponse(evidence);
    }

    const filters = {
        type: query.type,
        status: query.status,
        controlId: query.controlId,
        q: query.q,
        archived: query.archived === 'true' ? true : query.archived === 'false' ? false : undefined,
        expiring: query.expiring === 'true',
    };

    // If pagination params present, use paginated response
    if (query.limit !== undefined || query.cursor !== undefined) {
        const result = await listEvidencePaginated(ctx, {
            limit: query.limit,
            cursor: query.cursor,
            filters,
        });
        return jsonResponse(result);
    }

    // PR-5 — backfill cap. Ask for cap+1 rows; helper slices and
    // reports `truncated`.
    const evidence = await listEvidence(ctx, filters, { take: LIST_BACKFILL_CAP + 1 });
    const result = applyBackfillCap(evidence);
    // PR-6 — row-count observability.
    recordListPageRowCount({
        entity: 'evidence',
        count: result.rows.length,
        truncated: result.truncated,
        tenantId: ctx.tenantId,
    });
    return jsonResponse(result);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateEvidenceSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const evidence = await createEvidence(ctx, body);
    return jsonResponse(evidence, { status: 201 });
}));
