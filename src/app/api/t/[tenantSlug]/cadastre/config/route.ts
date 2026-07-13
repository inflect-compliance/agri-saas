/**
 * GET /api/t/[tenantSlug]/cadastre/config
 *
 * Feature-availability probe for the Bulgarian cadastre (КККР) overlay.
 * Returns ONLY a boolean — never the upstream WMS URL, which is server-only
 * (a paid №8002 licence is IP-bound to the VM). The client uses it to decide
 * whether to render the overlay toggle at all; when `configured:false` the
 * toggle stays hidden, matching the "hidden when unset" spec.
 *
 *   → { configured: boolean }
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { isCadastreConfigured } from '@/lib/geo/cadastre-source';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        // Auth + tenant-access gate (the boolean is tenant-agnostic, but the
        // route lives under the tenant tree so it must pass the same gate).
        await getTenantCtx(params, req);
        return jsonResponse({ configured: isCadastreConfigured() });
    },
);
