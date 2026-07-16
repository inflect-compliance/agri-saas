import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { getUserInterests, setUserInterests } from '@/app-layer/usecases/user-interests';
import { InterestsPutSchema } from '@/app-layer/schemas/interests.schemas';

/**
 * GET/PUT /api/t/[tenantSlug]/me/interests
 *
 * Self-service per-user interest keywords for the News "For You" tab. Own data
 * only — tenant-authed (getTenantCtx) with no role-permission gate; RLS + the
 * (tenantId, userId) filter in the usecase are the isolation, so a READER
 * manages their own interests exactly like an OWNER. PUT replaces the whole set
 * and returns the normalized result.
 */
export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const keywords = await getUserInterests(ctx);
        return jsonResponse({ keywords });
    },
);

export const PUT = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const body = InterestsPutSchema.parse(await req.json());
        const keywords = await setUserInterests(ctx, body.keywords);
        return jsonResponse({ keywords });
    },
);
