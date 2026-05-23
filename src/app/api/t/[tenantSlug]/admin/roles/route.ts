import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listCustomRoles, createCustomRole } from '@/app-layer/usecases/custom-roles';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const CreateRoleSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().nullable(),
    baseRole: z.enum(['ADMIN', 'EDITOR', 'AUDITOR', 'READER']),
    permissionsJson: z.record(z.string(), z.record(z.string(), z.boolean())),
});

export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        const roles = await listCustomRoles(ctx);
        return jsonResponse(roles);
    }),
);

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const body = await req.json();
        const input = CreateRoleSchema.parse(body);
        const role = await createCustomRole(ctx, input);
        return jsonResponse(role, { status: 201 });
    }),
);
