/**
 * RQ-9 — risk velocity: how fast exposure is changing.
 *
 * Compares each risk's current ALE to its value `windowDays` ago (from
 * RiskSnapshot), classifying the trend so the dashboard surfaces the
 * fastest-rising / fastest-falling risks and a portfolio direction.
 *
 * `velocityOf` + `classifyTrend` are pure — unit-testable.
 *
 * @module usecases/risk-velocity
 */
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanRead } from '../policies/common';
import { resolveALE } from './fair-calculator';

export type Trend = 'RISING' | 'FALLING' | 'STABLE';

export interface RiskVelocity {
    riskId: string;
    title: string;
    currentAle: number | null;
    previousAle: number | null;
    deltaAle: number;
    deltaPercent: number;
    trend: Trend;
    windowDays: number;
}

/** RISING if Δ > +5%, FALLING if Δ < -5%, else STABLE. */
export function classifyTrend(deltaPercent: number): Trend {
    if (deltaPercent > 5) return 'RISING';
    if (deltaPercent < -5) return 'FALLING';
    return 'STABLE';
}

/** Pure velocity for one risk. No previous data → zero/STABLE. */
export function velocityOf(riskId: string, title: string, currentAle: number | null, previousAle: number | null, windowDays: number): RiskVelocity {
    if (previousAle == null || currentAle == null) {
        return { riskId, title, currentAle, previousAle, deltaAle: 0, deltaPercent: 0, trend: 'STABLE', windowDays };
    }
    const deltaAle = currentAle - previousAle;
    const deltaPercent = previousAle > 0 ? (deltaAle / previousAle) * 100 : 0;
    return { riskId, title, currentAle, previousAle, deltaAle, deltaPercent, trend: classifyTrend(deltaPercent), windowDays };
}

export interface VelocityResult {
    topRising: RiskVelocity[];
    topFalling: RiskVelocity[];
    portfolioVelocity: { currentTotalAle: number; previousTotalAle: number; deltaPercent: number; trend: Trend };
}

export async function computeVelocity(ctx: RequestContext, opts: { windowDays?: number; limit?: number } = {}): Promise<VelocityResult> {
    assertCanRead(ctx);
    const windowDays = opts.windowDays ?? 30;
    const limit = opts.limit ?? 5;
    const cutoff = new Date(Date.now() - windowDays * 86400000);

    return runInTenantContext(ctx, async (db) => {
        const risks = await db.risk.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, title: true, fairAle: true, sleAmount: true, aroAmount: true },
            take: 10000,
        });
        const ids = risks.map((r) => r.id);
        // The snapshot nearest to `cutoff` per risk = the "previous" value.
        const prevSnaps = ids.length
            ? await db.riskSnapshot.findMany({
                where: { tenantId: ctx.tenantId, riskId: { in: ids }, snapshotAt: { lte: cutoff } },
                orderBy: { snapshotAt: 'desc' }, select: { riskId: true, ale: true, snapshotAt: true }, take: 50000,
            })
            : [];
        const prevByRisk = new Map<string, number | null>();
        for (const s of prevSnaps) if (!prevByRisk.has(s.riskId)) prevByRisk.set(s.riskId, s.ale); // first = most recent ≤ cutoff

        const velocities = risks.map((r) => {
            const current = resolveALE({ fairAle: r.fairAle, sleAmount: r.sleAmount, aroAmount: r.aroAmount });
            return velocityOf(r.id, r.title, current, prevByRisk.get(r.id) ?? null, windowDays);
        });

        const ranked = velocities.filter((v) => v.previousAle != null && v.currentAle != null);
        const topRising = ranked.filter((v) => v.trend === 'RISING').sort((a, b) => b.deltaPercent - a.deltaPercent).slice(0, limit);
        const topFalling = ranked.filter((v) => v.trend === 'FALLING').sort((a, b) => a.deltaPercent - b.deltaPercent).slice(0, limit);

        const currentTotalAle = velocities.reduce((s, v) => s + (v.currentAle ?? 0), 0);
        const previousTotalAle = velocities.reduce((s, v) => s + (v.previousAle ?? 0), 0);
        const portDelta = previousTotalAle > 0 ? ((currentTotalAle - previousTotalAle) / previousTotalAle) * 100 : 0;

        return {
            topRising, topFalling,
            portfolioVelocity: { currentTotalAle, previousTotalAle, deltaPercent: portDelta, trend: classifyTrend(portDelta) },
        };
    });
}
