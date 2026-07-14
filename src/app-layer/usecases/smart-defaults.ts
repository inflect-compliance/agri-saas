/**
 * Smart defaults — recall over EXISTING rows (recency / frequency), NO ML and
 * NO schema change. Powers the SprayJobWizard + location detail "do it again"
 * affordances: repeat the last job, pre-fill each parcel with what it last
 * received, default the rate unit, surface today's spray-window suitability,
 * and point at the next crop-plan milestone. Read-only; every query is
 * tenant-filtered AND bounded (take:).
 */
import { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { assertCanRead } from '../policies/common';
import { evaluateSprayWindow, type SprayWindowStatus, type SprayReason } from '@/lib/agro/rules';

/**
 * The most recent field operation on a location's parcels, regrouped into a
 * single repeatable job — one product + dose across its parcels (the wizard
 * collects exactly one).
 */
export interface SmartJobSuggestion {
    parcelIds: string[];
    productItemId: string;
    /** Decimal → number. */
    doseValue: number;
    doseUnitId: string;
    /** ISO; the createdAt of the latest line in the job. */
    occurredAt: string;
}

export interface SmartParcelDefault {
    productItemId: string;
    /** Decimal → number. */
    doseValue: number;
    doseUnitId: string;
}

export interface SmartSprayWindow {
    status: SprayWindowStatus;
    reasons: string[];
    /** Structured reasons for i18n at the UI layer (see SmartDefaultsBanner). */
    reasonCodes: SprayReason[];
    obsDate: string;
}

export interface SmartNextPlanting {
    id: string;
    label: string;
    stage: 'sow' | 'transplant' | 'harvest';
    date: string;
}

export interface LocationSmartDefaults {
    /** The latest field operation on this location's parcels, regrouped into one job. */
    repeatLast: SmartJobSuggestion | null;
    /** Per-parcel last-used product+dose (recency). Keyed by parcelId. */
    byParcel: Record<string, SmartParcelDefault>;
    /** Most-recently-used RATE unit across this location's operations. null if none. */
    defaultUnitId: string | null;
    /** Today's spray-window suitability from the latest WeatherObservation. null if no weather. */
    sprayWindow: SmartSprayWindow | null;
    /** The next upcoming crop-plan milestone for this location. null if none. */
    nextPlanting: SmartNextPlanting | null;
}

// Decimal | number | null → number (Prisma Decimal carries .toNumber()).
function toNumber(v: unknown): number {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && 'toNumber' in (v as object) && typeof (v as { toNumber: unknown }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
    }
    return Number(v);
}

// Decimal | number | null → number | null (preserves "no observation value").
function toNumberOrNull(v: unknown): number | null {
    if (v == null) return null;
    return toNumber(v);
}

export async function getLocationSmartDefaults(ctx: RequestContext, locationId: string): Promise<LocationSmartDefaults> {
    assertCanRead(ctx);
    const t = ctx.tenantId;
    const now = new Date();

    return runInTenantContext(ctx, async (db) => {
        // 1. This location's live parcels.
        const parcels = await db.parcel.findMany({
            where: { tenantId: t, locationId, deletedAt: null },
            select: { id: true },
            take: 500,
        });
        const parcelIds = parcels.map((p) => p.id);

        // No parcels ⇒ nothing op-derived to recall (weather + planting still apply).
        if (parcelIds.length === 0) {
            const [obs, planting] = await Promise.all([
                loadSprayWindow(db, t, locationId),
                loadNextPlanting(db, t, locationId, now),
            ]);
            return { repeatLast: null, byParcel: {}, defaultUnitId: null, sprayWindow: obs, nextPlanting: planting };
        }

        // 2. ONE bounded query over every op line on these parcels, newest first.
        //    Reused for byParcel, defaultUnitId, and to find the latest job's taskId.
        const lines = await db.operationParcel.findMany({
            where: { tenantId: t, parcelId: { in: parcelIds } },
            orderBy: { createdAt: 'desc' },
            select: { parcelId: true, taskId: true, productItemId: true, doseValue: true, doseUnitId: true, createdAt: true },
            take: 500,
        });

        // byParcel — first-seen-per-parcel == most recent (rows are createdAt desc).
        const byParcel: Record<string, SmartParcelDefault> = {};
        for (const l of lines) {
            if (!(l.parcelId in byParcel)) {
                byParcel[l.parcelId] = {
                    productItemId: l.productItemId,
                    doseValue: toNumber(l.doseValue),
                    doseUnitId: l.doseUnitId,
                };
            }
        }

        // defaultUnitId — unit of the most recent op line overall.
        const defaultUnitId = lines.length > 0 ? lines[0].doseUnitId : null;

        // 3. repeatLast — the latest line's taskId → load that job's lines, regroup.
        const [repeatLast, sprayWindow, nextPlanting] = await Promise.all([
            loadRepeatLast(db, t, lines.length > 0 ? lines[0].taskId : null),
            loadSprayWindow(db, t, locationId),
            loadNextPlanting(db, t, locationId, now),
        ]);

        return { repeatLast, byParcel, defaultUnitId, sprayWindow, nextPlanting };
    });
}

type Db = Parameters<Parameters<typeof runInTenantContext>[1]>[0];

async function loadRepeatLast(db: Db, tenantId: string, taskId: string | null): Promise<SmartJobSuggestion | null> {
    if (!taskId) return null;
    const jobLines = await db.operationParcel.findMany({
        where: { tenantId, taskId },
        orderBy: { createdAt: 'desc' },
        select: { parcelId: true, productItemId: true, doseValue: true, doseUnitId: true, createdAt: true },
        take: 100,
    });
    if (jobLines.length === 0) return null;

    // The wizard collects ONE product+dose across the job's parcels, so take
    // the product/dose from the latest line (jobLines[0]); if lines somehow
    // differ, the latest wins by design.
    const head = jobLines[0];
    return {
        parcelIds: jobLines.map((l) => l.parcelId),
        productItemId: head.productItemId,
        doseValue: toNumber(head.doseValue),
        doseUnitId: head.doseUnitId,
        occurredAt: head.createdAt.toISOString(),
    };
}

async function loadSprayWindow(db: Db, tenantId: string, locationId: string): Promise<SmartSprayWindow | null> {
    const obs = await db.weatherObservation.findFirst({
        where: { tenantId, locationId },
        orderBy: { obsDate: 'desc' },
        select: { obsDate: true, windMaxKmh: true, precipMm: true, tempMeanC: true },
    });
    if (!obs) return null;
    const { status, reasons, reasonCodes } = evaluateSprayWindow({
        windMaxKmh: toNumberOrNull(obs.windMaxKmh),
        precipMm: toNumberOrNull(obs.precipMm),
        tempMeanC: toNumberOrNull(obs.tempMeanC),
    });
    return { status, reasons, reasonCodes, obsDate: obs.obsDate.toISOString() };
}

async function loadNextPlanting(db: Db, tenantId: string, locationId: string, now: Date): Promise<SmartNextPlanting | null> {
    // Planting carries an optional locationId (planning.prisma) — scope to it.
    // The real PlantingStatus enum has no IN_PROGRESS; the not-yet-finished
    // states are PLANNED + the in-flight SOWN / TRANSPLANTED / HARVESTING
    // (HARVESTED / TERMINATED are done, so excluded).
    const plantings = await db.planting.findMany({
        where: {
            tenantId,
            locationId,
            deletedAt: null,
            status: { in: ['PLANNED', 'SOWN', 'TRANSPLANTED', 'HARVESTING'] },
        },
        select: {
            id: true,
            sowDate: true,
            transplantDate: true,
            harvestStartDate: true,
            variety: { select: { name: true } },
        },
        take: 200,
    });

    let best: SmartNextPlanting | null = null;
    let bestTime = Infinity;
    for (const p of plantings) {
        const label = p.variety?.name ?? 'Planting';
        const candidates: Array<{ stage: SmartNextPlanting['stage']; date: Date | null }> = [
            { stage: 'sow', date: p.sowDate },
            { stage: 'transplant', date: p.transplantDate },
            { stage: 'harvest', date: p.harvestStartDate },
        ];
        for (const c of candidates) {
            if (!c.date) continue;
            const ms = c.date.getTime();
            if (ms > now.getTime() && ms < bestTime) {
                bestTime = ms;
                best = { id: p.id, label, stage: c.stage, date: c.date.toISOString() };
            }
        }
    }
    return best;
}
