import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getEvidence, updateEvidence } from '@/app-layer/usecases/evidence';
import { withValidatedBody } from '@/lib/validation/route';
import { UpdateEvidenceSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const evidence = await getEvidence(ctx, params.id);
    return jsonResponse(evidence);
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdateEvidenceSchema, async (req, { params: paramsPromise }: { params: Promise<{ id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getLegacyCtx(req);
    const evidence = await updateEvidence(ctx, params.id, body);
    return jsonResponse({ success: true, evidence });
}));
