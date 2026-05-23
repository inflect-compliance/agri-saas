import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { verifyFileIntegrity } from '@/app-layer/usecases/audit-hardening';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; fileName: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const url = new URL(req.url);
    const expectedHash = url.searchParams.get('hash') || undefined;
    const result = await verifyFileIntegrity(ctx, params.fileName, expectedHash);
    return jsonResponse(result);
});
