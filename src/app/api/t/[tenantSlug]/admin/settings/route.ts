import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTenantAdminSettings } from '@/app-layer/usecases/tenant-admin';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        const settings = await getTenantAdminSettings(ctx);
        return jsonResponse(settings);
    }),
);
