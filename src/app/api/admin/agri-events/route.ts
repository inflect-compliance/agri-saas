import { NextRequest, NextResponse } from 'next/server';
import { withApiErrorHandling } from '@/lib/errors/api';
import { verifyPlatformApiKey, PlatformAdminError } from '@/lib/auth/platform-admin';
import { CreateAgriEventSchema } from '@/app-layer/schemas/agri-event.schemas';
import { createAgriEvent } from '@/app-layer/usecases/agri-events';

/**
 * Platform-admin curation of the GLOBAL agriculture-events catalogue (#15).
 *
 * `AgriEvent` has no tenantId — every tenant reads the same rows — so the write
 * path deliberately lives OUTSIDE `/api/t/[tenantSlug]/**`. A tenant-facing
 * write would let one farm edit what every other farm sees.
 *
 * Permission: platform-admin-key-gated — does not use requirePermission;
 * excluded from api-permission-coverage.test.ts guardrail with a reason.
 */
export const POST = withApiErrorHandling(async (req: NextRequest) => {
    try {
        verifyPlatformApiKey(req);
    } catch (err) {
        if (err instanceof PlatformAdminError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
    }

    const body = CreateAgriEventSchema.parse(await req.json());
    const event = await createAgriEvent(body, {
        requestId: req.headers.get('x-request-id') ?? 'platform-admin',
    });

    return NextResponse.json({ id: event.id }, { status: 201 });
});
