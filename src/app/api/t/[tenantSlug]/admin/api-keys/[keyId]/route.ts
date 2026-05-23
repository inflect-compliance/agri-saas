import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { revokeApiKey } from '@/app-layer/usecases/api-keys';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; keyId: string }>(
        'admin.manage',
        async (_req: NextRequest, { params }, ctx) => {
            const result = await revokeApiKey(ctx, params.keyId);
            return jsonResponse(result);
        },
    ),
);
