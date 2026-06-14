import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { cancelExecution } from '@/app-layer/usecases/automation-executions';

type Ctx = { params: Promise<{ tenantSlug: string; id: string }> };

// PATCH { action: 'cancel' } — operator interrupt for an in-flight execution.
const PatchSchema = z.object({ action: z.literal('cancel') });

export const PATCH = withApiErrorHandling(
    withValidatedBody(PatchSchema, async (req, { params: paramsPromise }: Ctx) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        return jsonResponse(await cancelExecution(ctx, params.id));
    }),
);
