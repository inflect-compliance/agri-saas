/**
 * PUT /api/t/[tenantSlug]/tests/plans/[planId]/schedule
 *
 * Epic G-2 — set or clear a control test plan's automation schedule.
 * The request body is shape-validated by zod (`ScheduleTestPlanSchema`);
 * the cross-field invariants (SCRIPT/INTEGRATION must have a cron;
 * MANUAL must not) and cron + IANA-tz parse-checks fire inside
 * `scheduleTestPlan` so the error message can name the plan.
 *
 * Permission gate: `assertCanManageTestPlans` (canWrite).
 */
import { getTenantCtx } from '@/app-layer/context';
import { scheduleTestPlan } from '@/app-layer/usecases/test-scheduling';
import { withValidatedBody } from '@/lib/validation/route';
import { ScheduleTestPlanSchema } from '@/lib/schemas';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const PUT = withApiErrorHandling(
    withValidatedBody(
        ScheduleTestPlanSchema,
        async (
            req,
            { params: paramsPromise }: { params: Promise<{ tenantSlug: string; planId: string }> },
            body,
        ) => {
            const params = await paramsPromise;
            const ctx = await getTenantCtx(params, req);
            const updated = await scheduleTestPlan(ctx, params.planId, {
                schedule: body.schedule,
                scheduleTimezone: body.scheduleTimezone,
                automationType: body.automationType,
                automationConfig: body.automationConfig,
            });
            return jsonResponse(updated);
        },
    ),
);
