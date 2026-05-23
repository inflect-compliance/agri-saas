import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { getQuestionnaireTemplate } from '@/app-layer/usecases/vendor';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; templateKey: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const template = await getQuestionnaireTemplate(ctx, params.templateKey);
    return jsonResponse(template);
});
