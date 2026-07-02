import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getFarmProfile, upsertFarmProfile } from '@/app-layer/usecases/farm-profile';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { z } from 'zod';

// БАБХ farm-record — the one-per-tenant FarmProfile identity block. Every
// field is optional free text (the paper form tolerates blanks). Gated by
// admin.manage (tenant configuration) — see route-permissions.ts.
const UpdateFarmProfileSchema = z
    .object({
        producerName: z.string().max(300).nullable().optional(),
        egn: z.string().max(20).nullable().optional(),
        eik: z.string().max(20).nullable().optional(),
        address: z.string().max(500).nullable().optional(),
        municipality: z.string().max(200).nullable().optional(),
        settlement: z.string().max(200).nullable().optional(),
        agricultureDirectorateCity: z.string().max(200).nullable().optional(),
        registrationPlace: z.string().max(200).nullable().optional(),
        registrationEkatte: z.string().max(20).nullable().optional(),
        odbhCity: z.string().max(200).nullable().optional(),
    })
    .strip();

export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        return jsonResponse(await getFarmProfile(ctx));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const body = UpdateFarmProfileSchema.parse(await req.json());
        return jsonResponse(await upsertFarmProfile(ctx, body));
    }),
);
