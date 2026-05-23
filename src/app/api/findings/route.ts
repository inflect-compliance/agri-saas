import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listFindings, createFinding } from '@/app-layer/usecases/finding';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateFindingSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const findings = await listFindings(ctx);
    return jsonResponse(findings);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateFindingSchema, async (req, _ctx, body) => {
    const ctx = await getLegacyCtx(req);
    const finding = await createFinding(ctx, body);
    return jsonResponse(finding, { status: 201 });
}));
