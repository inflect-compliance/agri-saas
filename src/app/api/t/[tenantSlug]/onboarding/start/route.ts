import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { startOnboarding } from '@/app-layer/usecases/onboarding';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const POST = withApiErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) => {
    const ctx = await getTenantCtx(await params, req);
    const state = await startOnboarding(ctx);
    return jsonResponse(state, { status: 200 });
});
