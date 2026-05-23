import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getReports } from '@/app-layer/usecases/report';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const data = await getReports(ctx);
    return jsonResponse(data);
});
