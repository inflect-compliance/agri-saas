import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { linkRisk, unlinkRisk } from '@/app-layer/usecases/risk-hierarchy';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-5 — link/unlink a risk to/from a hierarchy node. */
const Body = z.object({ riskId: z.string().min(1) });

export const POST = withApiErrorHandling(
    withValidatedBody(Body, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; nodeId: string }> }, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await linkRisk(ctx, body.riskId, params.nodeId);
        return jsonResponse({ success: true });
    }),
);

export const DELETE = withApiErrorHandling(
    withValidatedBody(Body, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; nodeId: string }> }, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await unlinkRisk(ctx, body.riskId, params.nodeId);
        return jsonResponse({ success: true });
    }),
);
