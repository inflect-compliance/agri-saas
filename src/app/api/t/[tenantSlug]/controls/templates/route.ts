import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listControlTemplates } from '@/app-layer/usecases/control';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

// GET /controls/templates — list available templates
export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const templates = await listControlTemplates(ctx);
    return jsonResponse(templates);
});
