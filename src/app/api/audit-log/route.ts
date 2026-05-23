import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { listAuditLogs } from '@/app-layer/usecases/auditLog';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const logs = await listAuditLogs(ctx);
    return jsonResponse(logs);
});
