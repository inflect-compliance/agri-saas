/**
 * Agriculture events (#15) — the GLOBAL events catalogue (fairs, trainings,
 * webinars, subsidy deadlines). `AgriEvent` has no tenantId (a shared catalog
 * like `Unit`), so the list is the same for every tenant. Read-only from the
 * app; population is via seed / admin tooling.
 *
 * @module app-layer/usecases/agri-events
 */
import type { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';

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
