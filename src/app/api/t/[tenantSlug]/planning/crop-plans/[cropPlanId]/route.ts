import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { getCropPlan, updateCropPlan, getCropPlanProgress } from '@/app-layer/usecases/crop-planning';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';

/**
 * A single crop plan (PLANNING module).
 *   GET   → the plan (season + crop + variety + planting count). Pass
 *           ?include=progress to also return the plan-vs-actual rows.
 *   PATCH → update plan fields (write-gated).
 */

const UpdateCropPlanSchema = z
    .object({
        name: z.string().min(1).max(200).optional(),
        cropVarietyId: z.string().nullable().optional(),
        locationId: z.string().nullable().optional(),
        parcelId: z.string().nullable().optional(),
        method: z.enum(['DIRECT_SOW', 'TRANSPLANT']).optional(),
        firstSowDate: z.string().min(8).optional(),
        successions: z.number().int().min(1).max(365).optional(),
        intervalDays: z.number().int().min(0).max(365).optional(),
        plantsPerSuccession: z.number().int().min(0).max(10000000).nullable().optional(),
        bedLengthM: z.number().min(0).max(1000000).nullable().optional(),
        rowsPerBed: z.number().int().min(0).max(1000).nullable().optional(),
        targetAreaM2: z.number().min(0).max(100000000).nullable().optional(),
        status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
        notes: z.string().max(5000).nullable().optional(),
    })
    .strip();

export const GET = withApiErrorHandling(
    async (
        req: NextRequest,
        { params: paramsPromise }: { params: Promise<{ tenantSlug: string; cropPlanId: string }> },
    ) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'PLANNING');
        const plan = await getCropPlan(ctx, params.cropPlanId);
        if (req.nextUrl.searchParams.get('include') === 'progress') {
            const progress = await getCropPlanProgress(ctx, params.cropPlanId);
            return jsonResponse({ plan, progress });
        }
        return jsonResponse(plan);
    },
);

export const PATCH = withApiErrorHandling(
    withValidatedBody(
        UpdateCropPlanSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; cropPlanId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            await assertModuleEnabled(ctx, 'PLANNING');
            const plan = await updateCropPlan(ctx, params.cropPlanId, body);
            return jsonResponse(plan);
        },
    ),
);
