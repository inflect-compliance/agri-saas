import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { listCropVarieties, createCropVariety } from '@/app-layer/usecases/crop-planning';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';

/**
 * Crop varieties — the succession-engine defaults catalog (PLANNING
 * module). A variety carries the agronomic numbers (days-to-maturity,
 * spacing, seed size) the engine reads.
 *   GET  → list varieties (optionally filtered by ?cropTypeId).
 *   POST → create a variety (write-gated).
 */

const CreateCropVarietySchema = z
    .object({
        cropTypeId: z.string().min(1, 'A crop type is required'),
        name: z.string().min(1, 'Variety name is required').max(200),
        key: z.string().max(100).nullable().optional(),
        defaultMethod: z.enum(['DIRECT_SOW', 'TRANSPLANT']).nullable().optional(),
        daysToGermination: z.number().int().min(0).max(3650).nullable().optional(),
        daysToTransplant: z.number().int().min(0).max(3650).nullable().optional(),
        daysToMaturity: z.number().int().min(0).max(3650).nullable().optional(),
        harvestWindowDays: z.number().int().min(0).max(3650).nullable().optional(),
        inRowSpacingCm: z.number().min(0).max(100000).nullable().optional(),
        betweenRowSpacingCm: z.number().min(0).max(100000).nullable().optional(),
        seedsPerGram: z.number().min(0).max(1000000).nullable().optional(),
        germinationRate: z.number().min(0).max(1).nullable().optional(),
        seedsPerCell: z.number().int().min(0).max(100).nullable().optional(),
        soilDefaultsJson: z
            .object({
                phMin: z.number().min(0).max(14).nullable().optional(),
                phMax: z.number().min(0).max(14).nullable().optional(),
                texturePreference: z.array(z.string().max(40)).max(12).nullable().optional(),
                drainagePreference: z.enum(['well', 'moderate', 'poor']).nullable().optional(),
            })
            .strip()
            .nullable()
            .optional(),
        gddBaseC: z.number().min(0).max(30).nullable().optional(),
        gddToMaturity: z.number().int().min(0).max(10000).nullable().optional(),
        sourceUrn: z.string().max(500).nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
    })
    .strip();

export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'PLANNING');
        const QuerySchema = z.object({ cropTypeId: z.string().optional() }).strip();
        const query = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
        const varieties = await listCropVarieties(ctx, { cropTypeId: query.cropTypeId });
        return jsonResponse(varieties);
    },
);

export const POST = withApiErrorHandling(
    withValidatedBody(
        CreateCropVarietySchema,
        async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            await assertModuleEnabled(ctx, 'PLANNING');
            const variety = await createCropVariety(ctx, body);
            return jsonResponse(variety, { status: 201 });
        },
    ),
);
