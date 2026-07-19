import { NextRequest, NextResponse } from 'next/server';
import { withApiErrorHandling } from '@/lib/errors/api';
import { verifyPlatformApiKey, PlatformAdminError } from '@/lib/auth/platform-admin';
import { UpdateAgriEventSchema } from '@/app-layer/schemas/agri-event.schemas';
import { updateAgriEvent, deleteAgriEvent } from '@/app-layer/usecases/agri-events';

/**
 * Platform-admin edit/removal of a single global agriculture event (#15).
 * See the sibling `../route.ts` for why curation is platform-level.
 *
 * Permission: platform-admin-key-gated — does not use requirePermission;
 * excluded from api-permission-coverage.test.ts guardrail with a reason.
 */

/** Shared gate; returns a response to short-circuit with, or null to proceed. */
function guard(req: NextRequest): NextResponse | null {
    try {
        verifyPlatformApiKey(req);
        return null;
    } catch (err) {
        if (err instanceof PlatformAdminError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
    }
}

export const PATCH = withApiErrorHandling(
    async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
        const denied = guard(req);
        if (denied) return denied;

        const { id } = await params;
        const body = UpdateAgriEventSchema.parse(await req.json());
        const event = await updateAgriEvent(id, body, {
            requestId: req.headers.get('x-request-id') ?? 'platform-admin',
        });

        return NextResponse.json({ id: event.id });
    },
);

export const DELETE = withApiErrorHandling(
    async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
        const denied = guard(req);
        if (denied) return denied;

        const { id } = await params;
        await deleteAgriEvent(id, {
            requestId: req.headers.get('x-request-id') ?? 'platform-admin',
        });

        return new NextResponse(null, { status: 204 });
    },
);
