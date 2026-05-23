/**
 * POST /api/t/[tenantSlug]/evidence/[id]/retention
 * Set retention dates on evidence. ADMIN/EDITOR only.
 * Body: { retentionUntil?, retentionPolicy?, retentionDays? }
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { updateEvidenceRetention } from '@/app-layer/usecases/evidence-retention';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const RetentionSchema = z.object({
    retentionUntil: z.string().datetime().nullable().optional(),
    retentionPolicy: z.enum(['NONE', 'FIXED_DATE', 'DAYS_AFTER_UPLOAD']).optional(),
    retentionDays: z.number().int().min(1).max(36500).nullable().optional(),
}).strip();

export const POST = withApiErrorHandling(async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> },
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const body = RetentionSchema.parse(await req.json());
    const result = await updateEvidenceRetention(ctx, params.id, body);
    return jsonResponse(result);
});
