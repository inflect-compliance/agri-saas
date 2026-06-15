import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getTenantCtx } from '@/app-layer/context';
import { assertModuleEnabled } from '@/app-layer/usecases/modules';
import { listSchemes, createScheme } from '@/app-layer/usecases/certification-scheme';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/**
 * Certification schemes — global AG_SCHEME frameworks surfaced per
 * tenant. Gated behind the CERTIFICATION module (the API twin of the
 * `/schemes` route-group `requireModule` redirect). The create path
 * additionally requires admin permission inside `createScheme`.
 */

// Inline body schema (kept in-file so structural guardrails see it).
const CreateSchemeSchema = z
    .object({
        key: z
            .string()
            .min(1)
            .max(120)
            // Stable, URL-/code-safe scheme key.
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Key must be alphanumeric with . _ -'),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        requirements: z
            .array(
                z.object({
                    code: z.string().min(1).max(60),
                    title: z.string().min(1).max(300),
                    description: z.string().max(2000).optional(),
                }),
            )
            .min(1, 'At least one requirement required')
            .max(500),
    })
    .strip();

export const GET = withApiErrorHandling(
    async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
        const params = await paramsPromise;
        const ctx = await getTenantCtx(params, req);
        await assertModuleEnabled(ctx, 'CERTIFICATION');
        const schemes = await listSchemes(ctx);
        return jsonResponse(schemes);
    },
);

export const POST = withApiErrorHandling(
    withValidatedBody(
        CreateSchemeSchema,
        async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            await assertModuleEnabled(ctx, 'CERTIFICATION');
            const scheme = await createScheme(ctx, body);
            return jsonResponse(scheme, { status: 201 });
        },
    ),
);
