import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listClauses } from '@/app-layer/usecases/clause';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const clauses = await listClauses(ctx);
    return jsonResponse(clauses);
});
