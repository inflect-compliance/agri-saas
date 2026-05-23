import { NextRequest } from 'next/server';
import { getPackByShareToken } from '@/app-layer/usecases/audit-readiness';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ token: string }> }) => {
    const params = await paramsPromise;
    const data = await getPackByShareToken(params.token);
    return jsonResponse(data);
});
