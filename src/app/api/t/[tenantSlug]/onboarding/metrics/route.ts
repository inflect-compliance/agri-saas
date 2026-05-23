import { getTenantCtx } from '@/app-layer/context';
import { getOnboardingMetrics } from '@/app-layer/usecases/onboarding';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req, { params }: { params: Promise<{ tenantSlug: string }> }) => {
    const ctx = await getTenantCtx(await params, req);
    const metrics = await getOnboardingMetrics(ctx);
    return jsonResponse(metrics);
});
