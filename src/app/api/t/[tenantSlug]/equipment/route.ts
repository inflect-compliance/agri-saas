import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listEquipment } from '@/app-layer/usecases/equipment';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * GET /api/t/[tenantSlug]/equipment — the tenant's active equipment, for
 * the farm-task equipment picker. Read-only (ungated, like /items GET).
 */
export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        const equipment = await listEquipment(ctx);
        return jsonResponse(equipment);
    },
);
