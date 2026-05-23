import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getDashboardData } from '@/app-layer/usecases/dashboard';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const data = await getDashboardData(ctx);
    return jsonResponse(data);
});
