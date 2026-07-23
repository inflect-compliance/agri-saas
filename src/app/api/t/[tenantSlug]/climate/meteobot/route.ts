import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { getMeteobotStationUrl, setMeteobotStationUrl } from '@/app-layer/usecases/modules';
import { isAllowedMeteobotUrl } from '@/lib/security/meteobot';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Per-tenant Meteobot station config (#14).
 *   GET → { meteobotStationUrl: string | null }   (READ)
 *   PUT { meteobotStationUrl: string | null } → set/clear   (ADMIN, in usecase)
 *
 * A non-empty URL must be an https link on an allowed meteobot.com host — the
 * SAME allowlist the CSP `frame-src` uses (`@/lib/security/meteobot`) — so the
 * app never stores a URL the browser would refuse to embed. `null` / `''`
 * clears the station.
 */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const meteobotStationUrl = await getMeteobotStationUrl(ctx);
        return jsonResponse({ meteobotStationUrl });
    },
);

const MeteobotSchema = z.object({
    meteobotStationUrl: z
        .string()
        .url()
        .max(2048)
        .refine(isAllowedMeteobotUrl, {
            message: 'The station URL must be an https link on a meteobot.com domain.',
        })
        .nullable()
        .or(z.literal('')),
});

export const PUT = withApiErrorHandling(
    withValidatedBody(
        MeteobotSchema,
        async (
            req: NextRequest,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await setMeteobotStationUrl(ctx, body.meteobotStationUrl || null);
            return jsonResponse(result);
        },
    ),
);
