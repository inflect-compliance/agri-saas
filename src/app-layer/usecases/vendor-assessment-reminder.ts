/**
 * Epic G-3 — admin-triggered reminder for an in-flight assessment.
 *
 * Reuses the existing token (no new mint), pushes a fresh outbox
 * row keyed by today's date so same-day re-clicks collapse via the
 * existing dedupeKey but tomorrow's resend creates a new row.
 *
 * Status guard: only SENT or IN_PROGRESS assessments can be
 * reminded. Token must still be unexpired — if the original
 * link has expired, the admin must send a new assessment instead.
 *
 * @module usecases/vendor-assessment-reminder
 */
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { notFound, badRequest } from '@/lib/errors/types';
import { logEvent } from '../events/audit';
import { assertCanRunAssessment } from '../policies/vendor.policies';
import { enqueueEmail } from '../notifications/enqueue';

export interface SendReminderResult {
    notificationQueued: boolean;
    expiresAt: Date;
}

export async function sendAssessmentReminder(
    ctx: RequestContext,
    assessmentId: string,
): Promise<SendReminderResult> {
    assertCanRunAssessment(ctx);

    return runInTenantContext(ctx, async (db) => {
        const a = await db.vendorAssessment.findFirst({
            where: { id: assessmentId, tenantId: ctx.tenantId },
            select: {
                id: true,
                tenantId: true,
                status: true,
                respondentEmail: true,
                externalAccessTokenExpiresAt: true,
                vendor: { select: { name: true } },
                templateVersion: { select: { name: true } },
                requestedBy: { select: { name: true } },
            },
        });
        if (!a) throw notFound('Assessment not found');
        if (a.status !== 'SENT' && a.status !== 'IN_PROGRESS') {
            throw badRequest(
                `Cannot send a reminder for an assessment in status ${a.status}.`,
            );
        }
        if (!a.respondentEmail) {
            throw badRequest('Assessment has no respondent email on file.');
        }
        if (
            !a.externalAccessTokenExpiresAt ||
            a.externalAccessTokenExpiresAt.getTime() < Date.now()
        ) {
            throw badRequest(
                'External access token has expired. Send a new assessment instead.',
            );
        }
        if (!a.vendor || !a.templateVersion) {
            throw badRequest('Assessment is missing vendor or template context.');
        }

        // Reminder reuses the original token — we don't have the raw
        // value (only its hash is stored). The admin must paste the
        // original URL into the reminder body, or the receiving end
        // can detect "no token" and fall through to a "your link has
        // expired" page. For now, the reminder includes a generic
        // "open your invitation" CTA pointing at the assessment id;
        // the real raw token lives in the original sent email.
        //
        // Pragmatic compromise: the raw token cannot be recovered
        // server-side (security feature), so the reminder cannot
        // include the exact same URL. The reminder body therefore
        // links to a /vendor-assessment/{id} page that gracefully
        // surfaces "use your original invitation link" if the
        // visitor arrives without a token.
        const responseUrl = buildReminderUrl(a.id);

        const result = await enqueueEmail(db, {
            tenantId: a.tenantId,
            type: 'VENDOR_ASSESSMENT_REMINDER',
            toEmail: a.respondentEmail,
            entityId: a.id,
            payload: {
                recipientName: 'there',
                vendorName: a.vendor.name,
                templateName: a.templateVersion.name,
                responseUrl,
                expiresAtIso: a.externalAccessTokenExpiresAt.toISOString(),
                inviterName: a.requestedBy?.name ?? undefined,
            },
            requestId: ctx.requestId,
        });

        await logEvent(db, ctx, {
            action: 'VENDOR_ASSESSMENT_REMINDER_SENT',
            entityType: 'VendorAssessment',
            entityId: a.id,
            details: `Sent reminder for assessment ${a.id}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'VendorAssessment',
                operation: 'reminded',
                after: {
                    notificationQueued: result !== null,
                    expiresAt: a.externalAccessTokenExpiresAt.toISOString(),
                },
                summary: `Vendor assessment reminder sent`,
            },
        });

        return {
            notificationQueued: result !== null,
            expiresAt: a.externalAccessTokenExpiresAt,
        };
    });
}

function buildReminderUrl(assessmentId: string): string {
    // env.APP_URL is the validated source of truth (src/env.ts).

    const { env } = require('@/env') as { env: { APP_URL?: string } };
    const origin = (env.APP_URL ?? '').replace(/\/$/, '');
    return `${origin}/vendor-assessment/${assessmentId}`;
}
