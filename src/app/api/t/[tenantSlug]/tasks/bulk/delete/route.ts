/**
 * POST /api/t/:slug/tasks/bulk/delete
 *
 * Bulk soft-delete tasks (the tasks table selection action-row). Permission
 * (write) + tenant isolation enforced in `bulkDeleteTask`. Body:
 * `{ taskIds: string[] }`. Returns `{ deleted: n }`.
 */
import { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { bulkDeleteTask } from '@/app-layer/usecases/task';
import { withApiErrorHandling } from '@/lib/errors/api';
import { withValidatedBody } from '@/lib/validation/route';
import { jsonResponse } from '@/lib/api-response';
import { z } from 'zod';

const BulkDeleteTaskSchema = z.object({
    taskIds: z.array(z.string().min(1)).min(1).max(100),
});

export const POST = withApiErrorHandling(
    withValidatedBody(
        BulkDeleteTaskSchema,
        async (
            req: NextRequest,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const result = await bulkDeleteTask(ctx, body.taskIds);
            return jsonResponse(result);
        },
    ),
);
