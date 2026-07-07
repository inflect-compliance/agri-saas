/**
 * Company promotions ("Offers" / Промоции) — #12.
 *
 * `Promotion` is a GLOBAL catalogue (no tenantId, like `Unit` / `AgriEvent`),
 * so the feed is the same for every tenant. Read-only from the app; population
 * is via seed / admin tooling. `createPromotionLead` captures an "Ask for
 * offer" lead (mirrors the Exchange inquiry flow) — the lead row commits first,
 * then a best-effort confirmation notification fires (fail-open).
 *
 * @module app-layer/usecases/promotions
 */
import type { RequestContext } from '../types';
import { assertCanRead, assertCanWrite } from '../policies/common';
import { logEvent } from '../events/audit';
import { runInTenantContext, withTenantDb } from '@/lib/db-context';
import { notFound, conflict } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { logger } from '@/lib/observability/logger';
import { Prisma } from '@prisma/client';

export interface PromotionDto {
    id: string;
    company: string;
    title: string;
    body: string | null;
    mediaUrl: string | null;
    category: string;
    ctaUrl: string | null;
    validFrom: string | null;
    validTo: string | null;
}

/**
 * Active promotions, newest first. "Active" = inside the optional validity
 * window (validFrom in the past or unset, validTo in the future or unset).
 * Bounded to a sensible page. The global catalogue carries no tenant scope,
 * but we still read it through the tenant transaction (no RLS on the table —
 * mirrors how the Unit / AgriEvent catalogues are read).
 */
export async function listActivePromotions(
    ctx: RequestContext,
    opts: { limit?: number; now?: Date } = {},
): Promise<PromotionDto[]> {
    assertCanRead(ctx);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const now = opts.now ?? new Date();
    return runInTenantContext(ctx, async (db) => {
        const rows = await db.promotion.findMany({
            where: {
                AND: [
                    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
                    { OR: [{ validTo: null }, { validTo: { gte: now } }] },
                ],
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return rows.map((p) => ({
            id: p.id,
            company: p.company,
            title: p.title,
            body: p.body,
            mediaUrl: p.mediaUrl,
            category: p.category,
            ctaUrl: p.ctaUrl,
            validFrom: p.validFrom ? p.validFrom.toISOString() : null,
            validTo: p.validTo ? p.validTo.toISOString() : null,
        }));
    });
}

export interface CreatePromotionLeadInput {
    promotionId: string;
    message: string;
    contextParcelId?: string | null;
}

/**
 * Capture an "Ask for offer" lead against a global promotion. The lead commits
 * first (inside the tenant transaction); a P2002 on the
 * @@unique([promotionId, inquirerTenantId]) becomes a friendly conflict so a
 * tenant can't spam a promotion. After commit, a best-effort confirmation
 * notification is written for the requesting user — fail-open, so a
 * notification error can never roll back the lead.
 */
export async function createPromotionLead(ctx: RequestContext, input: CreatePromotionLeadInput) {
    assertCanWrite(ctx);
    const sanitizedMessage = sanitizePlainText(input.message);

    const { lead, promotion } = await runInTenantContext(ctx, async (db) => {
        const promotion = await db.promotion.findUnique({ where: { id: input.promotionId } });
        if (!promotion) throw notFound('Promotion not found');

        let lead;
        try {
            lead = await db.promotionLead.create({
                data: {
                    promotionId: promotion.id,
                    inquirerTenantId: ctx.tenantId,
                    inquirerUserId: ctx.userId,
                    message: sanitizedMessage,
                    contextParcelId: input.contextParcelId ?? null,
                },
            });
        } catch (err) {
            // @@unique([promotionId, inquirerTenantId]) — one lead per tenant per
            // promotion. Turn the raw unique violation into a friendly conflict.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw conflict('You have already requested an offer for this promotion');
            }
            throw err;
        }

        await logEvent(db, ctx, {
            action: 'CREATE',
            entityType: 'PromotionLead',
            entityId: lead.id,
            details: `Offer request on promotion ${promotion.id}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'PromotionLead',
                operation: 'created',
                after: { promotionId: promotion.id },
                summary: `Offer request for ${promotion.company}: ${promotion.title}`,
            },
        });

        return { lead, promotion };
    });

    // Best-effort, fail-open — the lead is already committed.
    await notifyRequesterOfLead(ctx, promotion.company);

    return lead;
}

/**
 * Confirmation notification for the requesting user ("your request was sent").
 * Runs in the requester's own tenant context (Notification is RLS-forced) and
 * swallows every error (logs) so it can never roll back the lead. Promotions
 * are global with no provider tenant, so the confirmation is the whole notify
 * surface until a provider portal exists.
 */
async function notifyRequesterOfLead(ctx: RequestContext, company: string) {
    try {
        await withTenantDb(ctx.tenantId, async (db) => {
            await db.notification.create({
                data: {
                    tenantId: ctx.tenantId,
                    userId: ctx.userId,
                    type: 'GENERAL',
                    title: `Offer request sent to ${company}`,
                    message: 'The supplier will get back to you. You can track requests from the Offers page.',
                    linkUrl: ctx.tenantSlug ? `/t/${ctx.tenantSlug}/offers` : null,
                },
            });
        });
    } catch (err) {
        logger.warn('promotions.lead_notify_failed', {
            component: 'promotions',
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
