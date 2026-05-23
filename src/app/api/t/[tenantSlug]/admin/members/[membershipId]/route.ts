import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { updateTenantMemberRole } from '@/app-layer/usecases/tenant-admin';
import { assignCustomRole } from '@/app-layer/usecases/custom-roles';
import { withApiErrorHandling } from '@/lib/errors/api';
import { z } from 'zod';
import { jsonResponse } from '@/lib/api-response';

const UpdateMemberSchema = z.object({
    role: z.enum(['OWNER', 'ADMIN', 'EDITOR', 'AUDITOR', 'READER']).optional(),
    customRoleId: z.string().nullable().optional(),
});

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; membershipId: string }>(
        'admin.members',
        async (req: NextRequest, { params }, ctx) => {
            const body = await req.json();
            const input = UpdateMemberSchema.parse(body);

            let result;

            // If role change requested, update enum role
            if (input.role) {
                result = await updateTenantMemberRole(ctx, {
                    membershipId: params.membershipId,
                    role: input.role,
                });
            }

            // If customRoleId change requested (even if null = unassign)
            if (input.customRoleId !== undefined) {
                result = await assignCustomRole(
                    ctx,
                    params.membershipId,
                    input.customRoleId,
                );
            }

            if (!result) {
                return jsonResponse(
                    { error: 'No changes specified' },
                    { status: 400 },
                );
            }

            return jsonResponse(result);
        },
    ),
);
