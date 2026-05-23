import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listEvidence, createEvidence } from '@/app-layer/usecases/evidence';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateEvidenceSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const evidence = await listEvidence(ctx);
    return jsonResponse(evidence);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateEvidenceSchema, async (req, _ctx, body) => {
    const ctx = await getLegacyCtx(req);
    const item = await createEvidence(ctx, body);
    return jsonResponse(item, { status: 201 });
}));
