import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { getAppetiteConfig, upsertAppetiteConfig, getAppetiteStatus } from '@/app-layer/usecases/risk-appetite';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-2 — risk appetite config + live status. */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const [config, status] = await Promise.all([getAppetiteConfig(ctx), getAppetiteStatus(ctx)]);
        return jsonResponse({ config, status });
    },
);

const num = z.number().finite().nullable().optional();
const ConfigSchema = z.object({
    totalAleThreshold: num,
    singleRiskAleMax: num,
    qualScoreMax: z.number().int().nullable().optional(),
    /** RQ3-3 — which simulated percentile the ceiling is tested at. */
    testedPercentile: z
        .union([z.literal(50), z.literal(80), z.literal(90), z.literal(95), z.literal(99)])
        .optional(),
    categoryOverridesJson: z
        .record(z.string(), z.object({
            totalAleMax: z.number().optional(),
            singleAleMax: z.number().optional(),
            qualScoreMax: z.number().optional(),
        }))
        .nullable()
        .optional(),
    appetiteStatement: z.string().max(5000).nullable().optional(),
    approvedByUserId: z.string().nullable().optional(),
    approvedAt: z.string().nullable().optional(),
    reviewCadence: z.enum(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY']).optional(),
    nextReviewAt: z.string().nullable().optional(),
});

export const PUT = withApiErrorHandling(
    withValidatedBody(ConfigSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const config = await upsertAppetiteConfig(ctx, body);
        return jsonResponse({ success: true, config });
    }),
);
