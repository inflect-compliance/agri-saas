import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanWrite } from '@/app-layer/policies/common';
import { logEvent } from '@/app-layer/events/audit';
import { jsonResponse } from '@/lib/api-response';

// ─── Map a control to a requirement ───

const MapBody = z.object({
    requirementId: z.string().min(1),
    controlId: z.string().min(1),
}).strip();

export const POST = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    assertCanWrite(ctx);

    const body = MapBody.parse(await req.json());

    const result = await runInTenantContext(ctx, async (db) => {
        // Verify control belongs to tenant
        const control = await db.control.findFirst({
            where: { id: body.controlId, tenantId: ctx.tenantId },
            select: { id: true, code: true, name: true },
        });
        if (!control) throw new Error('Control not found');

        // Upsert mapping
        const link = await db.controlRequirementLink.upsert({
            where: {
                controlId_requirementId: {
                    controlId: body.controlId,
                    requirementId: body.requirementId,
                },
            },
            create: {
                tenantId: ctx.tenantId,
                controlId: body.controlId,
                requirementId: body.requirementId,
            },
            update: {},
        });

        await logEvent(db, ctx, {
            action: 'SOA_CONTROL_MAPPED',
            entityType: 'ControlRequirementLink',
            entityId: link.id,
            details: `Mapped control ${control.code || control.id} to requirement ${body.requirementId}`,
        });

        return link;
    });

    return jsonResponse(result, { status: 201 });
});
