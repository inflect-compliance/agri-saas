import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getEntraProvider, upsertEntraProvider } from '@/app-layer/usecases/entra-provider';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * EI-1 — tenant Entra-ID provider configuration.
 * Gated by `admin.manage`; denials audit as AUTHZ_DENIED (Epic C.1).
 */

/** GET — current Entra provider config (no secrets stored, but masked for parity). */
export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        const provider = await getEntraProvider(ctx);
        if (!provider) return jsonResponse(null);
        return jsonResponse({
            id: provider.id,
            isEnabled: provider.isEnabled,
            config: provider.configJson,
        });
    }),
);

/** POST — create/update the Entra provider from the wizard. */
export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const body = await req.json();
        const result = await upsertEntraProvider(ctx, body);
        return jsonResponse(result, { status: 201 });
    }),
);
