/**
 * Agriculture events (#15) — the GLOBAL events catalogue (fairs, trainings,
 * webinars, subsidy deadlines). `AgriEvent` has no tenantId (a shared catalog
 * like `Unit`), so the list is the same for every tenant.
 *
 * **Population.** Tenants can only READ this catalogue — a tenant-facing write
 * would let one farm edit what every other farm sees. Rows come from exactly
 * two places:
 *   - `scripts/seed-agri-events.ts` — DEMO rows, for local dev / demo /
 *     staging only (never production; the dates there are synthetic).
 *   - `POST|PATCH|DELETE /api/admin/agri-events` — the platform-admin curation
 *     API, gated by `PLATFORM_ADMIN_API_KEY` (the `createTenantWithOwner`
 *     pattern). This is the only path that populates production.
 *
 * @module app-layer/usecases/agri-events
 */
import type { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { logger } from '@/lib/observability';
import { badRequest, notFound } from '@/lib/errors/types';
import type {
    CreateAgriEventBody,
    UpdateAgriEventBody,
} from '@/app-layer/schemas/agri-event.schemas';

export interface AgriEventDto {
    id: string;
    title: string;
    description: string | null;
    category: string;
    startsAt: string;
    endsAt: string | null;
    place: string | null;
    url: string | null;
}

/**
 * Upcoming agriculture events, soonest first. "Upcoming" = the event hasn't
 * ended yet (endsAt in the future, or startsAt in the future when there's no
 * end). Bounded to a sensible page. The global catalogue carries no tenant
 * scope, but we still read it through the tenant transaction (no RLS on the
 * table — mirrors how the Unit catalogue is read).
 */
export async function listUpcomingAgriEvents(
    ctx: RequestContext,
    opts: { limit?: number; now?: Date } = {},
): Promise<AgriEventDto[]> {
    assertCanRead(ctx);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const now = opts.now ?? new Date();
    return runInTenantContext(ctx, async (db) => {
        const rows = await db.agriEvent.findMany({
            where: {
                OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }],
            },
            orderBy: { startsAt: 'asc' },
            take: limit,
        });
        return rows.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description,
            category: e.category,
            startsAt: e.startsAt.toISOString(),
            endsAt: e.endsAt ? e.endsAt.toISOString() : null,
            place: e.place,
            url: e.url,
        }));
    });
}

/**
 * The global prisma handle, resolved lazily.
 *
 * The tenant-facing read borrows the tenant transaction via
 * `runInTenantContext`; only the ctx-free probe and the platform-admin writes
 * need the global handle, and neither runs on most code paths that merely
 * IMPORT this module (the tenant layout imports it for the probe, the events
 * page for the list, unit tests for the exported surface). A top-level
 * `import { prisma }` made every such importer pay client instantiation —
 * measurably, it took `agriculture-usecases.test.ts` from ~55s to ~84s, and it
 * was the first module in that file's import graph to pull prisma in at all.
 * Lazy resolution keeps module load free, mirroring how `appendAuditEntry`
 * lazy-imports the audit-stream buffer.
 */
async function globalDb() {
    const { prisma } = await import('@/lib/prisma');
    return prisma;
}

/** The "upcoming" predicate, shared so the nav gate and the page agree on the word. */
function upcomingWhere(now: Date) {
    return { OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: now } }] };
}

/**
 * Existence-only check backing the sidebar's Events entry.
 *
 * Deliberately ctx-free: the tenant layout holds a `TenantServerContext`, not a
 * `RequestContext`, and the table has no tenant scope to enforce anyway. It is
 * a `findFirst`, not a `count` — we only need "is there anything", and the
 * `@@index([startsAt])` covers the predicate.
 *
 * Memoised in-process because the answer is IDENTICAL for every tenant and
 * every user: it depends only on the catalogue and the clock. The tenant layout
 * is `force-dynamic` + `noStore()` for permission freshness, which would
 * otherwise re-run this once per navigation per user across the fleet. The TTL
 * is deliberately short — "upcoming" is time-relative, so a cached `true` can
 * briefly outlive the last event. That is harmless: the nav gate is a polish
 * affordance and the page still renders its own empty state.
 */
const NONEMPTY_TTL_MS = 60_000;
let nonEmptyMemo: { value: boolean; expiresAt: number } | null = null;

export async function hasUpcomingAgriEvents(now: Date = new Date()): Promise<boolean> {
    if (nonEmptyMemo && nonEmptyMemo.expiresAt > now.getTime()) return nonEmptyMemo.value;
    const row = await (await globalDb()).agriEvent.findFirst({
        where: upcomingWhere(now),
        select: { id: true },
    });
    const value = row !== null;
    nonEmptyMemo = { value, expiresAt: now.getTime() + NONEMPTY_TTL_MS };
    return value;
}

/** Drop the memo so a curation write is reflected without waiting out the TTL. */
export function invalidateAgriEventsCache(): void {
    nonEmptyMemo = null;
}

/**
 * ── Platform-admin curation ──────────────────────────────────────────────
 *
 * These three take no `RequestContext` — they are called from
 * `PLATFORM_ADMIN_API_KEY`-gated routes with no user session, exactly like
 * `createTenantWithOwner` in `tenant-lifecycle.ts` (whose header documents the
 * same deliberate omission).
 *
 * **They are not written to `AuditLog`, and cannot be.** `AuditLog.tenantId` is
 * non-nullable with an FK to `Tenant`, and its hash chain is anchored per
 * tenant (`pg_advisory_xact_lock(hashtext(tenantId))`). A global catalogue has
 * no tenant to hang a row on, and the three workarounds are all wrong: a
 * sentinel tenantId dangles the FK, a synthesized `RequestContext` is the
 * anti-pattern `tenant-lifecycle.ts` calls out, and one row per tenant would
 * record a single global fact N times. So these follow the other half of the
 * platform-admin precedent — the structured log at `tenant-lifecycle.ts:153`.
 *
 * If this catalogue ever needs a tamper-evident ledger, the template is
 * `OrgAuditLog` + `src/lib/audit/org-audit-writer.ts`: a parallel chain keyed
 * on its own scope, which is how the repo already solves "audit something that
 * isn't tenant-scoped".
 */
export interface PlatformActor {
    /** Propagated from `x-request-id`; falls back to 'platform-admin'. */
    requestId: string;
}

export async function createAgriEvent(input: CreateAgriEventBody, actor: PlatformActor) {
    const event = await (await globalDb()).agriEvent.create({ data: input });
    invalidateAgriEventsCache();
    logger.info('agri-events.event_created', {
        component: 'agri-events',
        actorType: 'PLATFORM_ADMIN',
        requestId: actor.requestId,
        agriEventId: event.id,
        category: event.category,
        startsAt: event.startsAt.toISOString(),
    });
    return event;
}

export async function updateAgriEvent(
    id: string,
    input: UpdateAgriEventBody,
    actor: PlatformActor,
) {
    const existing = await (await globalDb()).agriEvent.findUnique({ where: { id } });
    if (!existing) throw notFound('Agriculture event not found');

    // The cross-field check the update schema can't make: a partial payload may
    // carry only one end of the span, so the other has to come from the row.
    const startsAt = input.startsAt ?? existing.startsAt;
    const endsAt = input.endsAt === undefined ? existing.endsAt : input.endsAt;
    if (endsAt && endsAt < startsAt) {
        throw badRequest('endsAt must not precede startsAt');
    }

    const event = await (await globalDb()).agriEvent.update({ where: { id }, data: input });
    invalidateAgriEventsCache();
    logger.info('agri-events.event_updated', {
        component: 'agri-events',
        actorType: 'PLATFORM_ADMIN',
        requestId: actor.requestId,
        agriEventId: event.id,
        fields: Object.keys(input),
    });
    return event;
}

export async function deleteAgriEvent(id: string, actor: PlatformActor): Promise<void> {
    const existing = await (await globalDb()).agriEvent.findUnique({
        where: { id },
        select: { id: true },
    });
    if (!existing) throw notFound('Agriculture event not found');
    await (await globalDb()).agriEvent.delete({ where: { id } });
    invalidateAgriEventsCache();
    logger.info('agri-events.event_deleted', {
        component: 'agri-events',
        actorType: 'PLATFORM_ADMIN',
        requestId: actor.requestId,
        agriEventId: id,
    });
}
