import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { listScenarios, createScenario, type ScenarioOverride } from '@/app-layer/usecases/risk-scenario';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** RQ-4 — scenarios list + create. */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const url = new URL(req.url);
        return jsonResponse({ scenarios: await listScenarios(ctx, { status: url.searchParams.get('status') ?? undefined }) });
    },
);

const OverrideSchema = z.object({
    riskId: z.string().nullable(),
    synthetic: z.boolean().optional(),
    fairInputs: z.unknown().optional(),
    title: z.string().optional(),
    field: z.string().optional(),
    newValue: z.number().optional(),
    rationale: z.string().optional(),
});
const CreateSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    investmentCost: z.number().nonnegative().nullable().optional(),
    overrides: z.array(OverrideSchema).max(100).optional(),
});

export const POST = withApiErrorHandling(
    withValidatedBody(CreateSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const scenario = await createScenario(ctx, {
            name: body.name,
            description: body.description,
            investmentCost: body.investmentCost,
            overrides: body.overrides as unknown as ScenarioOverride[] | undefined,
        });
        return jsonResponse({ success: true, scenario });
    }),
);
