/**
 * Achievements — the six meaningful farm milestones + a journaling streak,
 * all DERIVED from existing rows (no new schema). Read-only; safe to call on
 * the dashboard load. Each milestone reports `earned` + the timestamp it was
 * earned (so the UI can show "earned 3 days ago" and the client can fire a
 * one-time celebration). Routine saves never appear here — only the moments
 * that matter.
 */
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import type { MilestoneKey } from '@/lib/celebrations';

export interface AchievementItem {
    key: MilestoneKey;
    earned: boolean;
    /** ISO timestamp the milestone was earned, when derivable. */
    earnedAt: string | null;
}

export interface JournalStreak {
    /** Consecutive days (ending today or yesterday) with a journal entry. */
    current: number;
    /** Longest run ever. */
    best: number;
}

export interface AchievementsResult {
    milestones: AchievementItem[];
    streak: JournalStreak;
}

/** The ag milestones surfaced on the achievements card, in display order. */
export const AG_MILESTONE_ORDER: MilestoneKey[] = [
    'first-field-mapped',
    'spray-job-complete',
    'first-harvest',
    'season-closed',
    'inspection-passed',
    'sop-100-ack',
];

const DAY_MS = 86_400_000;

function dayKey(d: Date): string {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
function isConsecutive(earlier: string, later: string): boolean {
    return new Date(`${later}T00:00:00Z`).getTime() - new Date(`${earlier}T00:00:00Z`).getTime() === DAY_MS;
}

/**
 * Pure streak math (exported for tests). `current` is the run ending today
 * OR yesterday (a one-day grace so the streak isn't "broken" before the day
 * is even over); 0 if the most recent entry is older than that. `best` is the
 * longest run across the supplied dates.
 */
export function computeStreak(occurredAt: Date[], now: Date = new Date()): JournalStreak {
    if (occurredAt.length === 0) return { current: 0, best: 0 };
    const days = Array.from(new Set(occurredAt.map(dayKey))).sort();

    let best = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        run = isConsecutive(days[i - 1], days[i]) ? run + 1 : 1;
        if (run > best) best = run;
    }

    const today = dayKey(now);
    const yesterday = dayKey(new Date(now.getTime() - DAY_MS));
    const last = days[days.length - 1];
    let current = 0;
    if (last === today || last === yesterday) {
        current = 1;
        for (let i = days.length - 1; i > 0; i--) {
            if (isConsecutive(days[i - 1], days[i])) current++;
            else break;
        }
    }
    return { current, best };
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export async function getAchievements(ctx: RequestContext): Promise<AchievementsResult> {
    const t = ctx.tenantId;
    return runInTenantContext(ctx, async (db) => {
        const [firstField, sprayDone, firstHarvest, seasonClosed, inspection, activeMembers, publishedPolicies, streakRows] =
            await Promise.all([
                db.location.findFirst({ where: { tenantId: t, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
                db.task.findFirst({ where: { tenantId: t, type: 'FIELD_OPERATION', status: 'RESOLVED', deletedAt: null }, orderBy: { completedAt: 'asc' }, select: { completedAt: true } }),
                db.logEntry.findFirst({ where: { tenantId: t, type: 'HARVEST', status: 'DONE', deletedAt: null }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
                db.season.findFirst({ where: { tenantId: t, status: 'CLOSED', deletedAt: null }, orderBy: { endDate: 'asc' }, select: { endDate: true } }),
                db.auditPack.findFirst({ where: { tenantId: t, status: 'FROZEN', deletedAt: null, frozenAt: { not: null } }, orderBy: { frozenAt: 'asc' }, select: { frozenAt: true } }),
                db.tenantMembership.count({ where: { tenantId: t, status: 'ACTIVE' } }),
                db.policy.findMany({ where: { tenantId: t, deletedAt: null, currentVersionId: { not: null } }, select: { currentVersionId: true }, take: 200 }),
                db.logEntry.findMany({ where: { tenantId: t, status: 'DONE', deletedAt: null }, select: { occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 400 }),
            ]);

        // SOP 100% ack: a published policy whose current version is acknowledged
        // by every active member. Bounded: groupBy over the current versions.
        let sopEarned = false;
        const versionIds = publishedPolicies
            .map((p) => p.currentVersionId)
            .filter((v): v is string => Boolean(v));
        if (activeMembers > 0 && versionIds.length > 0) {
            const grouped = await db.policyAcknowledgement.groupBy({
                by: ['policyVersionId'],
                where: { policyVersionId: { in: versionIds } },
                _count: { _all: true },
            });
            sopEarned = grouped.some((g) => (g._count?._all ?? 0) >= activeMembers);
        }

        const milestones: AchievementItem[] = [
            { key: 'first-field-mapped', earned: !!firstField, earnedAt: iso(firstField?.createdAt) },
            { key: 'spray-job-complete', earned: !!sprayDone, earnedAt: iso(sprayDone?.completedAt) },
            { key: 'first-harvest', earned: !!firstHarvest, earnedAt: iso(firstHarvest?.occurredAt) },
            { key: 'season-closed', earned: !!seasonClosed, earnedAt: iso(seasonClosed?.endDate) },
            { key: 'inspection-passed', earned: !!inspection, earnedAt: iso(inspection?.frozenAt) },
            { key: 'sop-100-ack', earned: sopEarned, earnedAt: null },
        ];

        return { milestones, streak: computeStreak(streakRows.map((r) => r.occurredAt)) };
    });
}
