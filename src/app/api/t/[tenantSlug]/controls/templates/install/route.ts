import { getTenantCtx } from '@/app-layer/context';
import { installControlsFromTemplate } from '@/app-layer/usecases/control';
import { withValidatedBody } from '@/lib/validation/route';
import { InstallTemplatesSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

// POST /controls/templates/install — install controls from templates
export const POST = withApiErrorHandling(withValidatedBody(InstallTemplatesSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const results = await installControlsFromTemplate(ctx, body.templateIds);
    return jsonResponse(results, { status: 201 });
}));
