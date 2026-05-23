import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listAudits, createAudit } from '@/app-layer/usecases/audit';
import { withValidatedBody } from '@/lib/validation/route';
import { CreateAuditSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const audits = await listAudits(ctx);
    return jsonResponse(audits);
});

export const POST = withApiErrorHandling(withValidatedBody(CreateAuditSchema, async (req, _ctx, body) => {
    const ctx = await getLegacyCtx(req);
    const audit = await createAudit(ctx, body);
    return jsonResponse(audit, { status: 201 });
}));
