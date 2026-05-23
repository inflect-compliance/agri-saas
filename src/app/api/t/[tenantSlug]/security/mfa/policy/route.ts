import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTenantSecuritySettings, updateTenantMfaPolicy } from '@/app-layer/usecases/mfa';
import { withApiErrorHandling } from '@/lib/errors/api';
import { UpdateMfaPolicyInput } from '@/app-layer/schemas/mfa.schemas';
import { badRequest } from '@/lib/errors/types';
import { jsonResponse } from '@/lib/api-response';

/**
 * GET /api/t/[tenantSlug]/security/mfa/policy
 *
 * Returns the current MFA policy and session settings for the tenant.
 * Read access is open to any authenticated tenant member — the
 * settings page is visible across the tenant. Mutations are gated
 * separately by `admin.manage` on PUT.
 */
export const GET = withApiErrorHandling(async (
    req: NextRequest,
    { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const settings = await getTenantSecuritySettings(ctx);
    return jsonResponse(settings);
});

/**
 * PUT /api/t/[tenantSlug]/security/mfa/policy
 *
 * Updates the MFA policy for the tenant.
 * Gated by `admin.manage` (Epic D.3).
 */
export const PUT = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const raw = await req.json().catch(() => ({}));
        const parsed = UpdateMfaPolicyInput.safeParse(raw);
        if (!parsed.success) {
            throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');
        }
        const result = await updateTenantMfaPolicy(ctx, parsed.data);
        return jsonResponse(result);
    }),
);
