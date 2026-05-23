import { NextRequest } from 'next/server';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { getTenantCtx } from '@/app-layer/context';
import { RequestApprovalSchema } from '@/lib/schemas';
import * as policyUsecases from '@/app-layer/usecases/policy';
import { jsonResponse } from '@/lib/api-response';

// POST /api/t/[tenantSlug]/policies/[id]/approval — request approval
export const POST = withApiErrorHandling(
    withValidatedBody(RequestApprovalSchema, async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const approval = await policyUsecases.requestPolicyApproval(ctx, params.id, body.versionId);
        return jsonResponse(approval, { status: 201 });
    })
);
