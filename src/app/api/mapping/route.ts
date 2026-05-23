import { NextRequest } from 'next/server';
import { getLegacyCtx } from '@/app-layer/context';
import { getFrameworkMappings } from '@/app-layer/usecases/mapping';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    const ctx = await getLegacyCtx(req);
    const data = await getFrameworkMappings(ctx);
    return jsonResponse(data);
});
