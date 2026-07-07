import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listLogEntries, listLogEntriesPaginated, createLogEntry } from '@/app-layer/usecases/journal';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateLogEntrySchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { normalizeQ } from '@/lib/filters/query-helpers';
import { jsonResponse } from '@/lib/api-response';

const JournalQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
    type: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional().transform(normalizeQ),
    occurredFrom: z.string().optional(),
    occurredTo: z.string().optional(),
    // dnevnik filters (#10)
    crop: z.string().optional(),
    locationId: z.string().optional(),
}).strip();

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const query = JournalQuerySchema.parse(sp);

    const filters = {
        type: query.type,
        status: query.status,
        q: query.q,
        occurredFrom: query.occurredFrom,
        occurredTo: query.occurredTo,
        crop: query.crop,
        locationId: query.locationId,
    };

    const hasPagination = query.limit || query.cursor;
    if (hasPagination) {
        const result = await listLogEntriesPaginated(ctx, {
            limit: query.limit,
            cursor: query.cursor,
            filters,
        });
        return jsonResponse(result);
    }

    // Backward-compat: flat array (the list page reads this shape).
    const entries = await listLogEntries(ctx, filters);
    return jsonResponse(entries);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateLogEntrySchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const entry = await createLogEntry(ctx, body);
    return jsonResponse(entry, { status: 201 });
}));
