import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { updateMemberCertificates } from '@/app-layer/usecases/tenant-admin';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { z } from 'zod';

// БАБХ farm-record — the plant-protection certificates carried by a member.
// Three-state per field (null clears, omitted leaves unchanged). Covered by
// the `/admin/members(/.*)?` rule in route-permissions.ts.
const UpdateCertificatesSchema = z.object({
    applicatorCertNo: z.string().max(120).nullable().optional(),
    agronomistCertNo: z.string().max(120).nullable().optional(),
    agronomistName: z.string().max(200).nullable().optional(),
});

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; membershipId: string }>(
        'admin.members',
        async (req: NextRequest, { params }, ctx) => {
            const input = UpdateCertificatesSchema.parse(await req.json());
            const result = await updateMemberCertificates(ctx, {
                membershipId: params.membershipId,
                ...input,
            });
            return jsonResponse(result);
        },
    ),
);
