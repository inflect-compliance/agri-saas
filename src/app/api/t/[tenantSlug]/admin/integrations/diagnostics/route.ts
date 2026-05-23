/**
 * GET /api/t/[tenantSlug]/admin/integrations/diagnostics
 *
 * Admin-only diagnostics endpoint for integration health.
 * Returns:
 *   - last execution per connection
 *   - last webhook event per provider
 *   - recent errors summary
 *   - scheduler status
 *
 * Secrets are never included. Delegates to app-layer usecase.
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withApiErrorHandling } from '@/lib/errors/api';
import { getIntegrationDiagnostics } from '@/app-layer/usecases/integrations';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        const diagnostics = await getIntegrationDiagnostics(ctx);
        return jsonResponse(diagnostics);
    }),
);
