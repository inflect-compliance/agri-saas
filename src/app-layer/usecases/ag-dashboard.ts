import type { ModuleKey } from '@prisma/client';
import { RequestContext } from '../types';
import { assertCanRead } from '../policies/common';
import { listLogEntries } from './journal';
import { listLots } from './inventory';
import { listMyFarmTasks } from './farm-task';
import { getAchievements, type AchievementsResult } from './achievements';
import { getEnabledModules } from './modules';
import { listSchemes } from './certification-scheme';
import { generateReadinessReport } from './framework/coverage';

/**
 * Agriculture dashboard strip — the small "your farm today" read-model
 * that sits ABOVE the GRC executive cards on the tenant dashboard.
 *
 * This is a THIN aggregation: it reuses the existing list usecases
 * (`listLogEntries` / `listLots` / `listMyFarmTasks`) verbatim — every
 * one of those already authorizes via `assertCanRead`, scopes queries to
 * the tenant via `runInTenantContext` + RLS, and bounds its underlying
 * `findMany` with `take`. We add one more `assertCanRead` here for
 * defence-in-depth at the aggregation boundary, then slice each list to
 * the dashboard cap (≤ 5) for a glanceable strip.
 *
 * `enabledModules` is returned so the client strip can gate each card to
 * the module that owns it (JOURNAL → journal card, INVENTORY → low-stock
 * card; the farm-tasks card is always shown because Tasks is not
 * module-gated). A pure-GRC tenant with neither ag module enabled gets
 * empty lists + a module list that hides the journal/low-stock cards,
 * so the strip renders nothing.
 */

/** How many rows each card shows — a glanceable strip, not a list page. */
const STRIP_LIMIT = 5;

export interface AgDashboardJournalItem {
    id: string;
    type: string;
    title: string;
    occurredAt: string | null;
}

export interface AgDashboardLowStockItem {
    id: string;
    name: string;
    quantityOnHand: number;
    unitSymbol: string;
}

export interface AgDashboardTaskItem {
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
}

export interface AgDashboardCertification {
    schemeKey: string;
    schemeName: string;
    /** Readiness score (0–100) of the tenant's top certification scheme. */
    score: number;
}

export interface AgDashboardPayload {
    /** The tenant's enabled modules — drives client-side card gating. */
    enabledModules: ModuleKey[];
    recentJournal: AgDashboardJournalItem[];
    lowStock: AgDashboardLowStockItem[];
    myTasks: AgDashboardTaskItem[];
    /**
     * Readiness of the top certification scheme — present only when the
     * CERTIFICATION module is enabled AND at least one AG_SCHEME exists.
     * Null otherwise so the client card stays hidden for pure-farm tenants.
     */
    certification: AgDashboardCertification | null;
    /**
     * Earned milestones + journaling streak (derived from existing rows).
     * Null for a pure-GRC tenant with no ag module enabled, so the
     * achievements card stays hidden there.
     */
    achievements: AchievementsResult | null;
}

function toIso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export async function getAgDashboard(ctx: RequestContext): Promise<AgDashboardPayload> {
    assertCanRead(ctx);

    const enabledModules = await getEnabledModules(ctx);
    const journalOn = enabledModules.includes('JOURNAL');
    const inventoryOn = enabledModules.includes('INVENTORY');
    const certificationOn = enabledModules.includes('CERTIFICATION');
    // Achievements are an ag-product surface — computed for any farm tenant,
    // null for a pure-GRC tenant so the card never appears there.
    const achievementsOn = journalOn || inventoryOn || certificationOn || enabledModules.includes('PLANNING');

    // Fetch only what's enabled. Each underlying list is already bounded
    // (`take` in the repository) and authorizes independently; we run them
    // in parallel and slice to the strip cap below.
    const [journalEntries, lots, tasks, achievements] = await Promise.all([
        // LogEntry list — newest occurredAt first (repository orderBy).
        journalOn ? listLogEntries(ctx) : Promise.resolve([]),
        // Lots carry a computed `lowStock` boolean; we filter to those.
        // A take of 50 keeps the read bounded while leaving enough room to
        // surface the low-stock subset for the ≤5-row card.
        inventoryOn ? listLots(ctx, { take: 50 }) : Promise.resolve([]),
        // The caller's FARM_TASK + FIELD_OPERATION queue, soonest-due first.
        // Always fetched — Tasks is not module-gated.
        listMyFarmTasks(ctx),
        // Milestones + journaling streak (own tenant context; derived rows).
        achievementsOn ? getAchievements(ctx) : Promise.resolve(null),
    ]);

    const recentJournal: AgDashboardJournalItem[] = journalEntries
        .slice(0, STRIP_LIMIT)
        .map((e) => ({
            id: e.id,
            type: e.type,
            title: e.title,
            occurredAt: toIso(e.occurredAt),
        }));

    const lowStock: AgDashboardLowStockItem[] = lots
        .filter((l) => l.lowStock)
        .slice(0, STRIP_LIMIT)
        .map((l) => ({
            id: l.id,
            name: l.item.name,
            quantityOnHand: l.quantityOnHand,
            unitSymbol: l.unit.symbol,
        }));

    const myTasks: AgDashboardTaskItem[] = tasks
        .slice(0, STRIP_LIMIT)
        .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            dueAt: toIso(t.dueAt),
        }));

    // Certification readiness — top scheme only, gated on the module so a
    // pure-farm tenant never pays the readiness query. `listSchemes`
    // already orders AG_SCHEMEs by key asc, so the first is the "top".
    let certification: AgDashboardCertification | null = null;
    if (certificationOn) {
        const schemes = await listSchemes(ctx);
        const top = schemes[0];
        if (top) {
            const report = await generateReadinessReport(ctx, top.key);
            certification = {
                schemeKey: top.key,
                schemeName: top.name,
                score: report.summary.readinessScore,
            };
        }
    }

    return { enabledModules, recentJournal, lowStock, myTasks, certification, achievements };
}
