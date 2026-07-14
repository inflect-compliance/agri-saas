/**
 * GET /api/t/[tenantSlug]/cadastre/parcels/config
 *
 * Feature-availability probe for the FREE Bulgarian cadastre VECTOR parcels
 * overlay. Returns ONLY a boolean — never the upstream URL, which is
 * server-only. The client uses it to decide whether the cadastre toggle should
 * drive the vector overlay (preferred) vs the raster WMS path; when
 * `configured:false` the vector overlay is unavailable.
 *
 *   → { configured: boolean }
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { isCadastreParcelsConfigured } from '@/lib/geo/cadastre-source';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        // Auth + tenant-access gate (the boolean is tenant-agnostic, but the
        // route lives under the tenant tree so it must pass the same gate).
        await getTenantCtx(params, req);
        return jsonResponse({ configured: isCadastreParcelsConfigured() });
    },
);
