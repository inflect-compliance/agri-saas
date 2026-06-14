import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { dryRunRule } from '@/app-layer/usecases/automation-executions';

type Ctx = { params: Promise<{ tenantSlug: string; id: string }> };

const DryRunSchema = z.object({ sampleData: z.record(z.string(), z.unknown()).optional() });

export const POST = withApiErrorHandling(
    withValidatedBody(DryRunSchema, async (req, { params: paramsPromise }: Ctx, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        return jsonResponse(await dryRunRule(ctx, params.id, body.sampleData));
    }),
);
