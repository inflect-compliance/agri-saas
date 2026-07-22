import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { assertPlatformSupport } from '@/lib/auth/platform-support';
import { listCompanies } from '@/app-layer/usecases/promotion-admin';

/**
 * The supplier catalogue behind the global promotions feed (#12).
 *
 * This response carries DECRYPTED contact details — a named individual's work
 * email and phone. That is the console's purpose, and the platform-tenant gate
 * in `assertPlatformSupport` is what keeps it internal. Do not reuse this
 * payload on any tenant-facing surface; `listActivePromotions` deliberately
 * joins only `company.name`.
 */
export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        assertPlatformSupport(ctx);
        return jsonResponse({ companies: await listCompanies(ctx) });
    }),
);
