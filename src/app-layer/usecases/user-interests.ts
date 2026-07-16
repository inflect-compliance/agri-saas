/**
 * User interests — the per-user keyword list powering the News page's "For You"
 * tab. Tenant-scoped (RLS) + per-user: every query runs through
 * `runInTenantContext` and filters by `(tenantId, userId)`, so a user only ever
 * sees / replaces their OWN interests within the active tenant.
 *
 * Self-service preference data — there is no role-permission gate (a READER
 * manages their own interests just like an OWNER); `getTenantCtx` authentication
 * + RLS + the userId filter are the isolation.
 *
 * @module app-layer/usecases/user-interests
 */
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';

/** Hard caps so a client can never store an unbounded / oversized set. */
export const MAX_INTERESTS = 20;
export const MAX_KEYWORD_LEN = 50;

/**
 * Normalize a raw keyword list: trim, lowercase, drop empties, dedupe, cap each
 * keyword length and the total count. PURE — no I/O. Deterministic order
 * (input order, deduped) so a round-trip is stable.
 */
export function normalizeInterests(keywords: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of keywords) {
        if (typeof raw !== 'string') continue;
        const k = raw.trim().toLowerCase().slice(0, MAX_KEYWORD_LEN).trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(k);
        if (out.length >= MAX_INTERESTS) break;
    }
    return out;
}

/** Read the user's interest keywords (own rows in the active tenant), sorted. */
export async function getUserInterests(ctx: RequestContext): Promise<string[]> {
    return runInTenantContext(ctx, async (db) => {
        const rows = await db.userInterest.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId },
            select: { keyword: true },
            orderBy: { keyword: 'asc' },
            take: MAX_INTERESTS,
        });
        return rows.map((r) => r.keyword);
    });
}

/**
 * Replace the user's interest set (PUT semantics). Normalizes the input, then
 * clears + re-inserts inside the tenant context. Returns the stored set, sorted.
 */
export async function setUserInterests(
    ctx: RequestContext,
    keywords: readonly string[],
): Promise<string[]> {
    const normalized = normalizeInterests(keywords);
    return runInTenantContext(ctx, async (db) => {
        await db.userInterest.deleteMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId },
        });
        if (normalized.length > 0) {
            await db.userInterest.createMany({
                data: normalized.map((keyword) => ({
                    tenantId: ctx.tenantId,
                    userId: ctx.userId,
                    keyword,
                })),
                skipDuplicates: true,
            });
        }
        return [...normalized].sort();
    });
}
